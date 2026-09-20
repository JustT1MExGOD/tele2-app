package ru.t2sales.desktop.quick

import ru.t2sales.shared.api.EmployeeListItem

/**
 * A port of the server's phrase parser (backend/src/core/sales/nlp.ts): pairs of "number - metric" in any order, next to each other
 * ("2 сим", "сим 2", "две симки", "аксы 1500"). It gives an instant preview and works without a connection; the server parses the
 * same text again when the sale is written, so both must agree - the tests pin the server's own examples.
 */
object SaleText {
    private val WORD_NUM = mapOf(
        "ноль" to 0.0, "один" to 1.0, "одна" to 1.0, "одно" to 1.0, "два" to 2.0, "две" to 2.0, "три" to 3.0, "четыре" to 4.0,
        "пять" to 5.0, "шесть" to 6.0, "семь" to 7.0, "восемь" to 8.0, "девять" to 9.0, "десять" to 10.0
    )

    private val ALIASES = linkedMapOf(
        "sim" to listOf("sim", "сим", "симк", "симки", "симок", "симу", "симки"),
        "mnp" to listOf("mnp", "мнп", "перенос", "портир"),
        "pa" to listOf("pa", "па", "золот", "gold"),
        "combo" to listOf("combo", "комбо", "комб"),
        "phones" to listOf("phone", "телефон", "смарт", "труб"),
        "accessories" to listOf("акс", "accessories", "аксессуар", "чехол", "стек"),
        "insurance" to listOf("страх", "insurance", "страхов"),
        "wink" to listOf("wink", "винк"),
        "shpd" to listOf("shpd", "шпд", "интернет", "домашний"),
        "focus" to listOf("фо", "focus", "фокус"),
        "settings" to listOf("настрой", "settings"),
        "credit_request" to listOf("кредит заяв", "credit_request"),
        "credit_issued" to listOf("кредит выд", "credit_issued"),
        "plotter" to listOf("плотт", "plotter"),
        "hb" to listOf("hb", "нв", "heart")
    )

    val LABELS = mapOf(
        "sim" to "SIM", "mnp" to "MNP", "pa" to "ПА", "combo" to "Комбо", "phones" to "Телефоны", "accessories" to "Аксессуары",
        "insurance" to "Страховки", "wink" to "Wink", "shpd" to "ШПД", "focus" to "ФО", "settings" to "Настройки",
        "credit_request" to "Кредит заявка", "credit_issued" to "Кредит выдан", "plotter" to "Плоттер", "hb" to "НВ"
    )

    class Parsed(val metrics: Map<String, Double>, val unmatched: List<String>)

    private fun normalize(s: String) = s.lowercase().replace('ё', 'е').replace(Regex("[,;]+"), " ").replace(Regex("\\s+"), " ").trim()

    private fun number(tok: String): Double? =
        if (Regex("^\\d+([.,]\\d+)?$").matches(tok)) tok.replace(',', '.').toDouble() else WORD_NUM[tok]

    private fun metric(token: String): String? {
        for ((m, aliases) in ALIASES) for (a in aliases) if (token == a || token.startsWith(a)) return m
        return null
    }

    fun parse(input: String): Parsed {
        val tokens = normalize(input).split(' ').filter { it.isNotEmpty() }
        val metrics = LinkedHashMap<String, Double>()
        val used = HashSet<Int>()
        for (i in tokens.indices) {
            if (i in used) continue
            val n1 = number(tokens[i])
            val m1 = metric(tokens[i])
            if (n1 != null && i + 1 < tokens.size) {
                val m = metric(tokens[i + 1])
                if (m != null) { metrics[m] = (metrics[m] ?: 0.0) + n1; used += i; used += i + 1; continue }
            }
            if (m1 != null && i + 1 < tokens.size) {
                val n = number(tokens[i + 1])
                if (n != null) { metrics[m1] = (metrics[m1] ?: 0.0) + n; used += i; used += i + 1; continue }
            }
        }
        return Parsed(metrics, tokens.filterIndexed { i, _ -> i !in used })
    }

    fun label(metric: String) = LABELS[metric] ?: metric

    fun amount(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()

    /** "SIM × 2, MNP × 1" */
    fun summary(metrics: Map<String, Double>) = metrics.entries.joinToString(", ") { (m, v) -> "${label(m)} × ${amount(v)}" }

    /** A manager can start with a colleague's name: "иванов 3 аксы". */
    class WithEmployee(val employee: EmployeeListItem?, val rest: String)

    /**
     * Looks at the first word: when it is a name (a surname or first name start, 3+ letters, not a metric or a number) and exactly one
     * active employee matches, that employee is meant and the word is removed from the text. Anything ambiguous leaves the text alone.
     */
    fun splitEmployee(text: String, employees: List<EmployeeListItem>): WithEmployee {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val first = words.firstOrNull()?.let { normalize(it) } ?: return WithEmployee(null, text)
        if (first.length < 3 || number(first) != null || metric(first) != null) return WithEmployee(null, text)
        val hits = employees.filter { e ->
            e.is_active && normalize(e.full_name).split(' ').any { it.startsWith(first) }
        }
        return if (hits.size == 1) WithEmployee(hits.single(), words.drop(1).joinToString(" ")) else WithEmployee(null, text)
    }
}
