package ru.t2sales.android.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/** Small readers for the screens whose server payloads are dynamic (metric maps, nested blocks): a missing or odd value is just empty. */
internal fun JsonElement?.jo(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonElement?.ja(): JsonArray = this as? JsonArray ?: JsonArray(emptyList())
internal fun JsonElement?.js(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""
internal fun JsonElement?.jd(): Double? = (this as? JsonPrimitive)?.doubleOrNull
internal fun JsonElement?.ji(): Int? = (this as? JsonPrimitive)?.intOrNull
internal fun JsonElement?.jb(): Boolean = (this as? JsonPrimitive)?.booleanOrNull ?: false

/** 12 or 12.5, no trailing ".0". */
internal fun numText(v: Double?): String = v?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() } ?: "—"

// The names the screens ported from the PC client use (one shared set: private copies in several files of a package clash).
internal fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
internal fun JsonElement?.arr(): List<JsonElement> = (this as? JsonArray) ?: emptyList()
internal fun JsonElement?.dbl(): Double = (this as? JsonPrimitive)?.doubleOrNull ?: 0.0
internal fun JsonElement?.str(): String = (this as? JsonPrimitive)?.contentOrNull ?: ""
