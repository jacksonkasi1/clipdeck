package app.clipdeck.desktop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
 override fun onReceive(ctx: Context, intent: Intent) {
 if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
 val i = Intent(ctx, MonitorService::class.java)
 if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
 ctx.startForegroundService(i)
 } else {
 ctx.startService(i)
 }
 }
 }
}
