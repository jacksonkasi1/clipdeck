package app.clipdeck.desktop.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class DatabaseHelper(context: Context) :
 SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

 companion object {
 private const val DB_NAME = "clipdeck.db"
 private const val DB_VERSION = 1
 }

 override fun onCreate(db: SQLiteDatabase) {
 db.execSQL("""
 CREATE TABLE clipboard_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 content TEXT NOT NULL,
 content_type TEXT NOT NULL,
 timestamp INTEGER NOT NULL,
 source_app TEXT,
 is_favorite INTEGER DEFAULT 0,
 size_bytes INTEGER DEFAULT 0
 )
 """.trimIndent())
 db.execSQL("CREATE INDEX idx_timestamp ON clipboard_items(timestamp DESC)")
 db.execSQL("CREATE INDEX idx_favorite ON clipboard_items(is_favorite)")
 }

 override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
 db.execSQL("DROP TABLE IF EXISTS clipboard_items")
 onCreate(db)
 }

 fun insert(item: ClipboardItem): Long {
 val values = ContentValues().apply {
 put("content", item.content)
 put("content_type", item.contentType.name)
 put("timestamp", item.timestamp)
 put("source_app", item.sourceApp)
 put("is_favorite", if (item.isFavorite) 1 else 0)
 put("size_bytes", item.sizeBytes)
 }
 return writableDatabase.insert("clipboard_items", null, values)
 }

 fun getAll(): List<ClipboardItem> {
 val items = mutableListOf<ClipboardItem>()
 val cursor = readableDatabase.query(
 "clipboard_items", null, null, null, null, null,
 "timestamp DESC"
 )
 cursor.use { c ->
 while (c.moveToNext()) {
 items.add(readItem(c))
 }
 }
 return items
 }

 fun getAllCursor(): Cursor {
 return readableDatabase.query(
 "clipboard_items", null, null, null, null, null,
 "timestamp DESC"
 )
 }

 fun search(query: String): List<ClipboardItem> {
 val items = mutableListOf<ClipboardItem>()
 val like = "%$query%"
 val cursor = readableDatabase.query(
 "clipboard_items", null, "content LIKE ?", arrayOf(like),
 null, null, "timestamp DESC"
 )
 cursor.use { c ->
 while (c.moveToNext()) {
 items.add(readItem(c))
 }
 }
 return items
 }

 fun getFavorites(): List<ClipboardItem> {
 val items = mutableListOf<ClipboardItem>()
 val cursor = readableDatabase.query(
 "clipboard_items", null, "is_favorite = 1", null, null, null,
 "timestamp DESC"
 )
 cursor.use { c ->
 while (c.moveToNext()) {
 items.add(readItem(c))
 }
 }
 return items
 }

 fun delete(id: Long) {
 writableDatabase.delete("clipboard_items", "id = ?", arrayOf(id.toString()))
 }

 fun toggleFavorite(id: Long) {
 val values = ContentValues().apply {
 put("is_favorite", 1)
 }
 // Simple: set favorite (toggle logic handled by UI)
 val current = readableDatabase.rawQuery(
 "SELECT is_favorite FROM clipboard_items WHERE id = ?",
 arrayOf(id.toString())
 )
 current.use { c ->
 if (c.moveToFirst()) {
 val fav = c.getInt(0) == 0
 values.put("is_favorite", if (fav) 1 else 0)
 writableDatabase.update("clipboard_items", values, "id = ?", arrayOf(id.toString()))
 }
 }
 }

 fun deleteAll() {
 writableDatabase.delete("clipboard_items", null, null)
 }

 fun deleteOlderThan(timestamp: Long): Int {
 return writableDatabase.delete(
 "clipboard_items", "timestamp < ?", arrayOf(timestamp.toString())
 )
 }

 fun getCount(): Int {
 val cursor = readableDatabase.rawQuery("SELECT COUNT(*) FROM clipboard_items", null)
 cursor.use { c ->
 return if (c.moveToFirst()) c.getInt(0) else 0
 }
 }

 fun insertOrIgnore(item: ClipboardItem): Long {
 val existing = readableDatabase.rawQuery(
 "SELECT id FROM clipboard_items WHERE content = ? AND timestamp = ?",
 arrayOf(item.content, item.timestamp.toString())
 )
 existing.use { c ->
 if (c.moveToFirst()) {
 return c.getLong(0)
 }
 }
 return insert(item)
 }

 private fun readItem(c: Cursor): ClipboardItem {
 return ClipboardItem(
 id = c.getLong(c.getColumnIndexOrThrow("id")),
 content = c.getString(c.getColumnIndexOrThrow("content")),
 contentType = ContentType.valueOf(
 c.getString(c.getColumnIndexOrThrow("content_type"))
 ),
 timestamp = c.getLong(c.getColumnIndexOrThrow("timestamp")),
 sourceApp = c.getString(c.getColumnIndexOrThrow("source_app")),
 isFavorite = c.getInt(c.getColumnIndexOrThrow("is_favorite")) == 1,
 sizeBytes = c.getInt(c.getColumnIndexOrThrow("size_bytes"))
 )
 }
}
