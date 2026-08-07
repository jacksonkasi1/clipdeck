package app.clipdeck.desktop

import android.app.ActivityManager
import android.app.AlertDialog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputEditText
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// ============================================================
// DATA MODEL
// ============================================================
enum class ContentType { TEXT, URL, IMAGE, FILE }

data class ClipboardItem(
 val id: Long = 0,
 val content: String,
 val contentType: ContentType,
 val timestamp: Long,
 val sourceApp: String? = null,
 val isFavorite: Boolean = false,
 val sizeBytes: Int = 0
)

// ============================================================
// DATABASE
// ============================================================
class DbHelper(private val ctx: Context) :
 android.database.sqlite.SQLiteOpenHelper(ctx, "clipdeck.db", null, 1) {

 override fun onCreate(db: android.database.sqlite.SQLiteDatabase) {
 db.execSQL("CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, type TEXT, ts INTEGER, source TEXT, fav INTEGER)")
 db.execSQL("CREATE INDEX idx_ts ON items(ts DESC)")
 }

 override fun onUpgrade(db: android.database.sqlite.SQLiteDatabase, old: Int, new: Int) {
 db.execSQL("DROP TABLE IF EXISTS items")
 onCreate(db)
 }

 fun insert(content: String, type: String, ts: Long, source: String?): Long {
 val v = android.content.ContentValues()
 v.put("content", content)
 v.put("type", type)
 v.put("ts", ts)
 v.put("source", source)
 v.put("fav", 0)
 return writableDatabase.insert("items", null, v)
 }

 fun getAll(): List<ClipboardItem> {
 val out = mutableListOf<ClipboardItem>()
 val c = readableDatabase.query("items", null, null, null, null, null, "ts DESC")
 c.use { while (it.moveToNext()) { out.add(row(it)) } }
 return out
 }

 fun getCursor() = readableDatabase.query("items", null, null, null, null, null, "ts DESC")

 fun search(q: String): List<ClipboardItem> {
 val out = mutableListOf<ClipboardItem>()
 val c = readableDatabase.query("items", null, "content LIKE ?", arrayOf("%$q%"), null, null, "ts DESC")
 c.use { while (it.moveToNext()) { out.add(row(it)) } }
 return out
 }

 fun getFavs(): List<ClipboardItem> {
 val out = mutableListOf<ClipboardItem>()
 val c = readableDatabase.rawQuery("SELECT * FROM items WHERE fav=1 ORDER BY ts DESC", null)
 c.use { while (it.moveToNext()) { out.add(row(it)) } }
 return out
 }

 fun delete(id: Long) = writableDatabase.delete("items", "id=?", arrayOf(id.toString()))
 fun deleteAll() = writableDatabase.delete("items", null, null)
 fun count(): Int {
 val c = readableDatabase.rawQuery("SELECT COUNT(*) FROM items", null)
 c.use { return if (it.moveToFirst()) it.getInt(0) else 0 }
 }

 fun toggleFav(id: Long) {
 val cur = readableDatabase.rawQuery("SELECT fav FROM items WHERE id=?", arrayOf(id.toString()))
 cur.use {
 if (it.moveToFirst()) {
 val nv = if (it.getInt(0) == 0) 1 else 0
 writableDatabase.execSQL("UPDATE items SET fav=$nv WHERE id=$id")
 }
 }
 }

 private fun row(c: android.database.Cursor): ClipboardItem {
 val typeStr = c.getString(c.getColumnIndexOrThrow("type"))
 val ct = try { ContentType.valueOf(typeStr) } catch (e: Exception) { ContentType.TEXT }
 return ClipboardItem(
 id = c.getLong(c.getColumnIndexOrThrow("id")),
 content = c.getString(c.getColumnIndexOrThrow("content")),
 contentType = ct,
 timestamp = c.getLong(c.getColumnIndexOrThrow("ts")),
 sourceApp = c.getString(c.getColumnIndexOrThrow("source")),
 isFavorite = c.getInt(c.getColumnIndexOrThrow("fav")) == 1
 )
 }
}

// ============================================================
// ADAPTER
// ============================================================
class ClipboardAdapter(
 private var items: List<ClipboardItem>,
 private val onCopy: (ClipboardItem) -> Unit,
 private val onFav: (ClipboardItem) -> Unit,
 private val onDel: (ClipboardItem) -> Unit
) : RecyclerView.Adapter<ClipboardAdapter.VH>() {

 inner class VH(v: View) : RecyclerView.ViewHolder(v) {
 val content: TextView = v.findViewById(R.id.tvContent)
 val meta: TextView = v.findViewById(R.id.tvMeta)
 val btnFav: ImageButton = v.findViewById(R.id.btnFav)
 val btnCopy: ImageButton = v.findViewById(R.id.btnCopy)
 val btnDel: ImageButton = v.findViewById(R.id.btnDel)
 }

 override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
 val v = LayoutInflater.from(parent.context).inflate(R.layout.item_clipboard, parent, false)
 return VH(v)
 }

 override fun onBindViewHolder(h: VH, pos: Int) {
 val item = items[pos]
 h.content.text = item.content
 val color = when (item.contentType) {
 ContentType.URL -> 0xFF1A73E8.toInt()
 ContentType.IMAGE -> 0xFFE91E63.toInt()
 ContentType.FILE -> 0xFF4CAF50.toInt()
 else -> 0xFF212121.toInt()
 }
 h.content.setTextColor(color)
 val fmt = SimpleDateFormat("HH:mm", Locale.getDefault())
 val src = item.sourceApp?.substringAfterLast('.')?.replaceFirstChar { it.uppercase() } ?: "Unknown"
 val typeLabel = when (item.contentType) {
 ContentType.URL -> "Link"
 ContentType.IMAGE -> "Image"
 ContentType.FILE -> "File"
 else -> "Text"
 }
 h.meta.text = "$src · ${fmt.format(Date(item.timestamp))} · $typeLabel"
 h.btnFav.setImageResource(if (item.isFavorite) R.drawable.ic_star_filled else R.drawable.ic_star_outline)
 h.content.setOnClickListener { onCopy(item) }
 h.btnFav.setOnClickListener { onFav(item) }
 h.btnCopy.setOnClickListener { onCopy(item) }
 h.btnDel.setOnClickListener { onDel(item) }
 }

 override fun getItemCount() = items.size
 fun update(newItems: List<ClipboardItem>) {
 items = newItems
 notifyDataSetChanged()
 }
}

// ============================================================
// FOREGROUND SERVICE
// ============================================================
class MonitorService : Service() {
 private val binder = LocalBinder()
 private var cm: ClipboardManager? = null
 private var listener: ClipboardManager.OnPrimaryClipChangedListener? = null
 private var lastHash = 0
 private val db by lazy { DbHelper(this) }

 inner class LocalBinder : android.os.Binder() {
 fun getService() = this@MonitorService
 }

 override fun onCreate() {
 super.onCreate()
 cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
 }

 override fun onStartCommand(i: Intent?, f: Int, s: Int): Int {
 startForeground(NOTIF_ID, makeNotif())
 startListening()
 return START_STICKY
 }

 override fun onBind(i: Intent): IBinder = binder

 override fun onDestroy() {
 stopListening()
 super.onDestroy()
 }

 fun startListening() {
 if (listener != null) return
 listener = ClipboardManager.OnPrimaryClipChangedListener {
 val clip = cm?.primaryClip ?: return@OnPrimaryClipChangedListener
 if (clip.itemCount == 0) return@OnPrimaryClipChangedListener
 val text = clip.getItemAt(0).coerceToText(this).toString()
 val hash = text.hashCode()
 if (hash == lastHash || text.isBlank()) return@OnPrimaryClipChangedListener
 lastHash = hash
 val isUrl = text.trim().startsWith("http://") || text.trim().startsWith("https://")
 val type = if (isUrl) ContentType.URL else ContentType.TEXT
 val src = try {
 val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
 am.runningAppProcesses?.firstOrNull { it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND }
 ?.processName
 } catch (e: Exception) { null }
 db.insert(text, type.name, System.currentTimeMillis(), src)
 }
 cm?.addPrimaryClipChangedListener(listener!!)
 }

 fun stopListening() {
 listener?.let { cm?.removePrimaryClipChangedListener(it) }
 listener = null
 }

 fun clearHistory() {
 db.deleteAll()
 lastHash = 0
 }

 private fun makeNotif(): Notification {
 val pi = PendingIntent.getActivity(
 this, 0, Intent(this, MainActivity::class.java),
 PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
 )
 return androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
 .setContentTitle("Clipmo")
 .setContentText("Clipboard monitoring active")
 .setSmallIcon(R.mipmap.ic_launcher)
 .setContentIntent(pi)
 .setOngoing(true)
 .build()
 }

 companion object {
 const val CHANNEL_ID = "clipmo_channel"
 const val NOTIF_ID = 1
 }
}

// ============================================================
// MAIN ACTIVITY
// ============================================================
class MainActivity : AppCompatActivity() {
 private lateinit var db: DbHelper
 private lateinit var adapter: ClipboardAdapter
 private var searchQuery: String = ""

 override fun onCreate(savedInstanceState: Bundle?) {
 super.onCreate(savedInstanceState)
 setContentView(R.layout.activity_main)
 db = DbHelper(this)
 adapter = ClipboardAdapter(
 emptyList(),
 { copyToClipboard(it) },
 { db.toggleFav(it.id); refresh() },
 { confirmDelete(it) }
 )
 val rv = findViewById<RecyclerView>(R.id.recyclerView)
 rv.layoutManager = LinearLayoutManager(this)
 rv.adapter = adapter
 val search = findViewById<TextInputEditText>(R.id.searchField)
 search.addTextChangedListener(object : TextWatcher {
 override fun afterTextChanged(s: Editable?) {
 searchQuery = s?.toString() ?: ""
 refresh()
 }
 override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
 override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
 })
 findViewById<SwitchMaterial>(R.id.toggleMonitor).setOnCheckedChangeListener { _, on ->
 if (on) startService() else stopService()
 }
 findViewById<FloatingActionButton>(R.id.btnClear).setOnClickListener { confirmClearAll() }
 requestPerms()
 }

 override fun onResume() {
 super.onResume()
 refresh()
 }

 private fun refresh() {
 val list = if (searchQuery.isBlank()) db.getAll() else db.search(searchQuery)
 adapter.update(list)
 }

 private fun startService() {
 val i = Intent(this, MonitorService::class.java)
 if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i) else startService(i)
 }

 private fun stopService() {
 stopService(Intent(this, MonitorService::class.java))
 }

 private fun copyToClipboard(item: ClipboardItem) {
 val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
 cm.setPrimaryClip(ClipData.newPlainText("Clipmo", item.content))
 Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
 }

 private fun confirmDelete(item: ClipboardItem) {
 AlertDialog.Builder(this)
 .setTitle("Delete?")
 .setMessage(item.content.take(100))
 .setPositiveButton("Delete") { _, _ -> db.delete(item.id); refresh() }
 .setNegativeButton("Cancel", null)
 .show()
 }

 private fun confirmClearAll() {
 if (db.count() == 0) return
 AlertDialog.Builder(this)
 .setTitle("Clear all history?")
 .setMessage("This cannot be undone.")
 .setPositiveButton("Clear") { _, _ -> db.deleteAll(); refresh() }
 .setNegativeButton("Cancel", null)
 .show()
 }

 private fun requestPerms() {
 val perms = mutableListOf<String>()
 if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
 if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
 != PackageManager.PERMISSION_GRANTED) {
 perms.add(android.Manifest.permission.POST_NOTIFICATIONS)
 }
 }
 if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
 !android.provider.Settings.canDrawOverlays(this)) {
 startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
 android.net.Uri.parse("package:$packageName")))
 }
 if (perms.isNotEmpty()) {
 ActivityCompat.requestPermissions(this, perms.toTypedArray(), 100)
 }
 }
}
