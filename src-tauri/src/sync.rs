//! Local-network clipboard sync.
//!
//! The service is deliberately best-effort and off the capture path: clipboard
//! writes enqueue small text-like payloads to a bounded worker, while discovery
//! and peer delivery run on background threads.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::db::Db;
use crate::models::{
    now_ms, ClipItem, DeviceIdentity, ItemKind, Settings, SyncPeer, SyncState, SyncStatus,
};

const DISCOVERY_PORT: u16 = 47633;
const SYNC_PORT: u16 = 47634;
const TICK: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct SyncService {
    peers: Arc<RwLock<HashMap<String, PeerRecord>>>,
    sender: mpsc::SyncSender<SyncJob>,
}

impl SyncService {
    pub fn inactive() -> Self {
        let (sender, _receiver) = mpsc::sync_channel::<SyncJob>(1);
        Self {
            peers: Arc::new(RwLock::new(HashMap::new())),
            sender,
        }
    }

    pub fn start(
        app: AppHandle,
        db: Arc<Db>,
        settings: Arc<RwLock<Settings>>,
    ) -> std::io::Result<Self> {
        let peers = Arc::new(RwLock::new(HashMap::new()));
        let (sender, receiver) = mpsc::sync_channel::<SyncJob>(64);

        spawn_discovery(Arc::clone(&peers), Arc::clone(&settings), app.clone())?;
        spawn_tcp_server(
            Arc::clone(&peers),
            Arc::clone(&settings),
            Arc::clone(&db),
            app.clone(),
        )?;
        spawn_sender(Arc::clone(&peers), Arc::clone(&settings), receiver);

        Ok(Self { peers, sender })
    }

    pub fn enqueue_item(&self, item: &ClipItem) {
        if !is_syncable(item.kind) {
            return;
        }
        let job = SyncJob {
            item: SyncItem {
                kind: item.kind,
                preview: item.preview.clone(),
                content: item.content.clone(),
                content_hash: crate::clipboard::hash_text(&item.content),
                copied_at: item.last_copied_at,
            },
        };
        if self.sender.try_send(job).is_err() {
            log::warn!("sync queue is full; latest clipboard item will stay local");
        }
    }

    pub fn state(&self, settings: &Settings) -> SyncState {
        SyncState {
            enabled: settings.sync_enabled,
            device: settings.device_identity(),
            pairing_code: settings.sync_pairing_code.clone(),
            peers: self
                .peers
                .read()
                .values()
                .map(|peer| SyncPeer {
                    device: peer.device.clone(),
                    last_seen_at: peer.last_seen_at,
                    status: if now_ms() - peer.last_seen_at > 30_000 {
                        SyncStatus::Offline
                    } else {
                        SyncStatus::Synced
                    },
                })
                .collect(),
        }
    }
}

#[derive(Clone)]
struct PeerRecord {
    device: DeviceIdentity,
    address: SocketAddr,
    last_seen_at: i64,
}

#[derive(Debug)]
struct SyncJob {
    item: SyncItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryMessage {
    protocol: String,
    pairing_code: String,
    device: DeviceIdentity,
    tcp_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncEnvelope {
    protocol: String,
    pairing_code: String,
    device: DeviceIdentity,
    item: SyncItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncItem {
    kind: ItemKind,
    preview: String,
    content: String,
    content_hash: String,
    copied_at: i64,
}

fn spawn_discovery(
    peers: Arc<RwLock<HashMap<String, PeerRecord>>>,
    settings: Arc<RwLock<Settings>>,
    app: AppHandle,
) -> std::io::Result<()> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT))?;
    socket.set_broadcast(true)?;
    socket.set_read_timeout(Some(Duration::from_millis(500)))?;
    let receiver = socket.try_clone()?;
    let listener_settings = Arc::clone(&settings);

    std::thread::Builder::new()
        .name("sync-discovery-listen".into())
        .spawn(move || listen_for_peers(receiver, peers, listener_settings, app))?;

    std::thread::Builder::new()
        .name("sync-discovery-send".into())
        .spawn(move || broadcast_presence(socket, settings))?;
    Ok(())
}

fn listen_for_peers(
    socket: UdpSocket,
    peers: Arc<RwLock<HashMap<String, PeerRecord>>>,
    settings: Arc<RwLock<Settings>>,
    app: AppHandle,
) {
    let mut buf = [0u8; 4096];
    loop {
        let Ok((len, source)) = socket.recv_from(&mut buf) else {
            continue;
        };
        let Ok(message) = serde_json::from_slice::<DiscoveryMessage>(&buf[..len]) else {
            continue;
        };
        let current = settings.read().clone();
        if !current.sync_enabled
            || message.protocol != "clipdeck-lan-v1"
            || message.pairing_code != current.sync_pairing_code
            || message.device.id == current.sync_device_id
        {
            continue;
        }
        let address = SocketAddr::new(source.ip(), message.tcp_port);
        peers.write().insert(
            message.device.id.clone(),
            PeerRecord {
                device: message.device,
                address,
                last_seen_at: now_ms(),
            },
        );
        let _ = app.emit("sync-peers-updated", ());
    }
}

fn broadcast_presence(socket: UdpSocket, settings: Arc<RwLock<Settings>>) {
    loop {
        let current = settings.read().clone();
        if current.sync_enabled {
            let device = current.device_identity();
            let message = DiscoveryMessage {
                protocol: "clipdeck-lan-v1".into(),
                pairing_code: current.sync_pairing_code.clone(),
                device,
                tcp_port: SYNC_PORT,
            };
            if let Ok(bytes) = serde_json::to_vec(&message) {
                let target = SocketAddr::new(IpAddr::V4(Ipv4Addr::BROADCAST), DISCOVERY_PORT);
                let _ = socket.send_to(&bytes, target);
            }
        }
        std::thread::sleep(TICK);
    }
}

fn spawn_tcp_server(
    peers: Arc<RwLock<HashMap<String, PeerRecord>>>,
    settings: Arc<RwLock<Settings>>,
    db: Arc<Db>,
    app: AppHandle,
) -> std::io::Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, SYNC_PORT))?;
    listener.set_nonblocking(true)?;
    std::thread::Builder::new()
        .name("sync-tcp-server".into())
        .spawn(move || loop {
            match listener.accept() {
                Ok((stream, address)) => {
                    handle_incoming(stream, address, &peers, &settings, &db, &app);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(error) => log::warn!("sync TCP accept failed: {error}"),
            }
        })?;
    Ok(())
}

fn handle_incoming(
    stream: TcpStream,
    address: SocketAddr,
    peers: &Arc<RwLock<HashMap<String, PeerRecord>>>,
    settings: &Arc<RwLock<Settings>>,
    db: &Arc<Db>,
    app: &AppHandle,
) {
    let current = settings.read().clone();
    if !current.sync_enabled {
        return;
    }
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let Ok(envelope) = serde_json::from_str::<SyncEnvelope>(&line) else {
        return;
    };
    if envelope.protocol != "clipdeck-lan-v1"
        || envelope.pairing_code != current.sync_pairing_code
        || envelope.device.id == current.sync_device_id
        || !is_syncable(envelope.item.kind)
    {
        return;
    }
    peers.write().insert(
        envelope.device.id.clone(),
        PeerRecord {
            device: envelope.device.clone(),
            address,
            last_seen_at: now_ms(),
        },
    );
    match db.import_synced_text_item(
        &envelope.device,
        envelope.item.kind,
        &envelope.item.content,
        &envelope.item.content_hash,
    ) {
        Ok(upsert) => {
            if let Ok(Some(item)) = db.get(upsert.id()) {
                let _ = app.emit("clip-updated", &item);
            }
            let _ = app.emit("sync-peers-updated", ());
        }
        Err(error) => log::warn!("synced item could not be imported: {error}"),
    }
}

fn spawn_sender(
    peers: Arc<RwLock<HashMap<String, PeerRecord>>>,
    settings: Arc<RwLock<Settings>>,
    receiver: mpsc::Receiver<SyncJob>,
) {
    std::thread::Builder::new()
        .name("sync-send".into())
        .spawn(move || {
            while let Ok(job) = receiver.recv() {
                let current = settings.read().clone();
                if !current.sync_enabled {
                    continue;
                }
                let device = current.device_identity();
                let envelope = SyncEnvelope {
                    protocol: "clipdeck-lan-v1".into(),
                    pairing_code: current.sync_pairing_code.clone(),
                    device,
                    item: job.item,
                };
                let Ok(mut payload) = serde_json::to_vec(&envelope) else {
                    continue;
                };
                payload.push(b'\n');
                for peer in peers.read().values().cloned() {
                    if let Ok(mut stream) =
                        TcpStream::connect_timeout(&peer.address, Duration::from_millis(750))
                    {
                        let _ = stream.write_all(&payload);
                    }
                }
            }
        })
        .expect("sync sender thread should start");
}

fn is_syncable(kind: ItemKind) -> bool {
    matches!(
        kind,
        ItemKind::Text | ItemKind::Link | ItemKind::Email | ItemKind::Color
    )
}
