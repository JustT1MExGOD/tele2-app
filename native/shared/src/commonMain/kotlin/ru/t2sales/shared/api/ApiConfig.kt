package ru.t2sales.shared.api

/**
 * The web frontend derives its API base URL from window.location.origin
 * (backend/frontend/src/shared/api/http-client.ts) — a native app has no
 * such ambient value, so the canonical production origin is hardcoded here
 * instead. TODO: make this user-configurable (e.g. staging override) once
 * the milestone's read-only slice is proven; not needed yet.
 */
object ApiConfig {
    const val PROD_API_BASE: String = "https://tele2-app-production.up.railway.app"
}
