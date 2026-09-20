package ru.t2sales.desktop.quick

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import ru.t2sales.shared.api.EmployeeListItem

class SaleTextTest {
    private fun m(text: String) = SaleText.parse(text).metrics

    // the three examples from the server's own docs (backend/src/core/sales/nlp.ts)
    @Test fun theServersOwnExamples() {
        assertEquals(mapOf("sim" to 2.0, "mnp" to 1.0), m("две симки и одно mnp"))
        assertEquals(mapOf("sim" to 3.0, "pa" to 1.0, "combo" to 2.0), m("3 sim 1 па 2 комбо"))
        assertEquals(mapOf("sim" to 2.0, "accessories" to 1500.0), m("сим 2, аксы 1500"))
    }

    @Test fun eitherOrderCommasCaseAndYo() {
        assertEquals(mapOf("sim" to 2.0), m("СИМ 2"))
        assertEquals(mapOf("sim" to 2.0), m("2 Сим"))
        assertEquals(mapOf("phones" to 1.0, "sim" to 2.0), m("телефон одна, две сим"))
        assertEquals(mapOf("hb" to 1.0), m("1 нв"))
        assertEquals(mapOf("accessories" to 1500.0), m("1500 аксессуары"))
    }

    @Test fun repeatedMetricAddsUp() {
        assertEquals(mapOf("sim" to 3.0), m("2 сим 1 сим"))
    }

    @Test fun decimalsAndWordNumbers() {
        assertEquals(mapOf("accessories" to 1250.5), m("аксы 1250.5"))
        // a comma is a separator (the server turns it into a space), so "1250,5" is 1250 and a stray 5, exactly as on the server
        assertEquals(mapOf("accessories" to 1250.0), m("аксы 1250,5"))
        assertEquals(listOf("5"), SaleText.parse("аксы 1250,5").unmatched)
        assertEquals(mapOf("sim" to 10.0), m("десять сим"))
    }

    @Test fun aMetricWithoutANumberIsNotGuessed() {
        // the same as the server: it needs a number next to the word, otherwise the sale is refused rather than guessed
        assertTrue(m("mnp").isEmpty())
        assertTrue(m("сим телефон").isEmpty())
        assertEquals(mapOf("sim" to 2.0), m("2 сим mnp"))
        assertEquals(listOf("mnp"), SaleText.parse("2 сим mnp").unmatched)
    }

    @Test fun nothingRecognisedGivesAnEmptyResult() {
        assertTrue(m("").isEmpty())
        assertTrue(m("привет как дела").isEmpty())
        assertEquals(listOf("привет", "как", "дела"), SaleText.parse("привет как дела").unmatched)
    }

    @Test fun summaryIsReadable() {
        assertEquals("SIM × 2, Комбо × 1", SaleText.summary(linkedMapOf("sim" to 2.0, "combo" to 1.0)))
        assertEquals("Аксессуары × 1500", SaleText.summary(mapOf("accessories" to 1500.0)))
        assertEquals("Аксессуары × 1250.5", SaleText.summary(mapOf("accessories" to 1250.5)))
    }
}

class SplitEmployeeTest {
    private val team = listOf(
        EmployeeListItem(1, "Иванов Иван Иванович"),
        EmployeeListItem(2, "Петров Пётр Петрович"),
        EmployeeListItem(3, "Симонов Сергей Львович"),
        EmployeeListItem(4, "Иванова Мария Ивановна"),
        EmployeeListItem(5, "Уволенный Иван Петрович", is_active = false)
    )

    @Test fun aUniqueSurnameStartPicksTheEmployeeAndIsRemovedFromTheText() {
        val r = SaleText.splitEmployee("петров 3 аксы", team)
        assertEquals(2, assertNotNull(r.employee).id)
        assertEquals("3 аксы", r.rest)
        assertEquals("Пётр", SaleText.splitEmployee("пётр 2 сим", team).employee?.full_name?.split(" ")?.get(1))
    }

    @Test fun anAmbiguousNameIsLeftAlone() {
        // "иванов" matches Иванов Иван AND ... only one has that surname, but "иван" is a first name of two people
        assertNull(SaleText.splitEmployee("иван 2 сим", team).employee)
        assertEquals("иван 2 сим", SaleText.splitEmployee("иван 2 сим", team).rest)
    }

    @Test fun aMetricOrANumberIsNeverTakenForAName() {
        // "сим" is the start of a surname (Симонов) but it is the SIM metric: the sale is for the person typing
        val r = SaleText.splitEmployee("сим 2", team)
        assertNull(r.employee)
        assertEquals("сим 2", r.rest)
        assertNull(SaleText.splitEmployee("2 сим", team).employee)
        assertNull(SaleText.splitEmployee("две симки", team).employee)
    }

    @Test fun inactiveEmployeesAndShortWordsAreIgnored() {
        assertNull(SaleText.splitEmployee("уволенный 1 сим", team).employee)
        assertNull(SaleText.splitEmployee("ив 1 сим", team).employee)
        assertNull(SaleText.splitEmployee("", team).employee)
    }
}
