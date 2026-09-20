package ru.t2sales.shared

import kotlinx.serialization.json.Json
import ru.t2sales.shared.api.DashboardResponse
import ru.t2sales.shared.api.MeResponse
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Decodes real response shapes captured from the live backend (GET /me,
 * GET /dashboard) to catch field-name/shape mismatches before ever touching
 * the network — see Milestone 1 verification step 2.
 */
class ApiTypesSerializationTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun decodesMeResponse() {
        val raw = """
            {"bound": true, "employee_id": 42, "full_name": "Иван Иванов", "role": "manager", "org_id": "org-1", "phone": "+79990000000"}
        """.trimIndent()
        val me = json.decodeFromString(MeResponse.serializer(), raw)
        assertEquals(true, me.bound)
        assertEquals(42, me.employee_id)
        assertEquals("manager", me.role)
    }

    @Test
    fun decodesDashboardResponse() {
        val raw = """
            {
              "top": [{"employee_id": 1, "full_name": "A", "sim": 3.0, "mnp": 1.0, "pa": 2.0, "combo": 0.0, "phones": 5.0, "accessories": 2.0, "score": 91.5}],
              "top7": [],
              "period": {"from": "2026-09-01", "to": "2026-09-17"}
            }
        """.trimIndent()
        val dashboard = json.decodeFromString(DashboardResponse.serializer(), raw)
        assertEquals(1, dashboard.top.size)
        assertEquals("A", dashboard.top[0].full_name)
        assertEquals("2026-09-17", dashboard.period.to)
    }
}
