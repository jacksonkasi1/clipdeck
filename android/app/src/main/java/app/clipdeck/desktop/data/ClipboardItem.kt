package app.clipdeck.desktop.data

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
