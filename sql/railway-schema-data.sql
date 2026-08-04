\restrict ZB8h0OoErmjOK9KqJ7Hf9TkE2ue2fuht0eYjbu6pF6b6RoPcDKyxNk7zup3SsYH

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.access_requests (
    id bigint NOT NULL,
    telegram_id bigint NOT NULL,
    telegram_username text,
    full_name text NOT NULL,
    claimed_employee_id bigint,
    message text DEFAULT ''::text,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by bigint,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.access_requests OWNER TO postgres;

--
-- Name: access_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.access_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.access_requests_id_seq OWNER TO postgres;

--
-- Name: access_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.access_requests_id_seq OWNED BY public.access_requests.id;


--
-- Name: alert_flags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alert_flags (
    id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.alert_flags OWNER TO postgres;

--
-- Name: announcement_reads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.announcement_reads (
    announcement_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    read_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.announcement_reads OWNER TO postgres;

--
-- Name: announcements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.announcements (
    id bigint NOT NULL,
    org_id text,
    title text NOT NULL,
    body text NOT NULL,
    required boolean DEFAULT true,
    active boolean DEFAULT true,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.announcements OWNER TO postgres;

--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.announcements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.announcements_id_seq OWNER TO postgres;

--
-- Name: announcements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.app_settings OWNER TO postgres;

--
-- Name: bfq_manual; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bfq_manual (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    month date NOT NULL,
    vmr_avg numeric DEFAULT 0,
    penalty numeric DEFAULT 0
);


ALTER TABLE public.bfq_manual OWNER TO postgres;

--
-- Name: bfq_manual_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bfq_manual_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bfq_manual_id_seq OWNER TO postgres;

--
-- Name: bfq_manual_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bfq_manual_id_seq OWNED BY public.bfq_manual.id;


--
-- Name: bfq_questionnaires; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bfq_questionnaires (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    score numeric NOT NULL,
    comment text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.bfq_questionnaires OWNER TO postgres;

--
-- Name: bfq_questionnaires_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bfq_questionnaires_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bfq_questionnaires_id_seq OWNER TO postgres;

--
-- Name: bfq_questionnaires_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bfq_questionnaires_id_seq OWNED BY public.bfq_questionnaires.id;


--
-- Name: channel_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.channel_messages (
    id bigint NOT NULL,
    channel_id text NOT NULL,
    author_id bigint,
    body text NOT NULL,
    due_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.channel_messages OWNER TO postgres;

--
-- Name: channel_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.channel_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channel_messages_id_seq OWNER TO postgres;

--
-- Name: channel_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.channel_messages_id_seq OWNED BY public.channel_messages.id;


--
-- Name: channels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.channels (
    id text NOT NULL,
    org_id text,
    kind text NOT NULL,
    store_id text,
    title text NOT NULL
);


ALTER TABLE public.channels OWNER TO postgres;

--
-- Name: combo_calculations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.combo_calculations (
    id bigint NOT NULL,
    employee_id bigint,
    phone_price numeric NOT NULL,
    discount_pct integer NOT NULL,
    result numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.combo_calculations OWNER TO postgres;

--
-- Name: combo_calculations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.combo_calculations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.combo_calculations_id_seq OWNER TO postgres;

--
-- Name: combo_calculations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.combo_calculations_id_seq OWNED BY public.combo_calculations.id;


--
-- Name: employee_badges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_badges (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    badge_code text NOT NULL,
    title text,
    earned_at timestamp with time zone DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.employee_badges OWNER TO postgres;

--
-- Name: employee_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_badges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employee_badges_id_seq OWNER TO postgres;

--
-- Name: employee_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_badges_id_seq OWNED BY public.employee_badges.id;


--
-- Name: employee_month_plan_values; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_month_plan_values (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    month date NOT NULL,
    metric_id text NOT NULL,
    value numeric DEFAULT 0 NOT NULL
);


ALTER TABLE public.employee_month_plan_values OWNER TO postgres;

--
-- Name: employee_month_plan_values_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_month_plan_values_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employee_month_plan_values_id_seq OWNER TO postgres;

--
-- Name: employee_month_plan_values_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_month_plan_values_id_seq OWNED BY public.employee_month_plan_values.id;


--
-- Name: employee_month_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employee_month_plans (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    month date NOT NULL,
    sim numeric DEFAULT 0,
    mnp numeric DEFAULT 0,
    pa numeric DEFAULT 0,
    combo numeric DEFAULT 0,
    phones numeric DEFAULT 0,
    accessories numeric DEFAULT 0,
    focus numeric DEFAULT 0,
    settings numeric DEFAULT 0,
    wink numeric DEFAULT 0,
    shpd numeric DEFAULT 0,
    insurance numeric DEFAULT 0,
    credit numeric DEFAULT 0,
    plotter numeric DEFAULT 0,
    hb numeric DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    credit_request numeric DEFAULT 0,
    credit_issued numeric DEFAULT 0,
    imp numeric DEFAULT 0,
    import numeric DEFAULT 0,
    esim numeric DEFAULT 0
);


ALTER TABLE public.employee_month_plans OWNER TO postgres;

--
-- Name: employee_month_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employee_month_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employee_month_plans_id_seq OWNER TO postgres;

--
-- Name: employee_month_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employee_month_plans_id_seq OWNED BY public.employee_month_plans.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.employees (
    id bigint NOT NULL,
    full_name text NOT NULL,
    short_name text,
    telegram_id bigint,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    role text DEFAULT 'employee'::text NOT NULL,
    access_status text DEFAULT 'active'::text NOT NULL,
    verified_by bigint,
    verified_at timestamp with time zone,
    requested_at timestamp with time zone,
    org_id text,
    level integer DEFAULT 1,
    xp integer DEFAULT 0,
    streak_days integer DEFAULT 0,
    best_shift_score numeric DEFAULT 0,
    hire_date date
);


ALTER TABLE public.employees OWNER TO postgres;

--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employees_id_seq OWNER TO postgres;

--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: offline_sync_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.offline_sync_log (
    id bigint NOT NULL,
    client_id text NOT NULL,
    employee_id bigint,
    telegram_id bigint,
    payload jsonb NOT NULL,
    status text DEFAULT 'applied'::text,
    error text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.offline_sync_log OWNER TO postgres;

--
-- Name: offline_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.offline_sync_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.offline_sync_log_id_seq OWNER TO postgres;

--
-- Name: offline_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.offline_sync_log_id_seq OWNED BY public.offline_sync_log.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organizations (
    id text NOT NULL,
    name text NOT NULL,
    brand_name text,
    logo_url text,
    theme_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.organizations OWNER TO postgres;

--
-- Name: plan_metrics; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plan_metrics (
    id text NOT NULL,
    label text NOT NULL,
    short_label text,
    unit text DEFAULT 'count'::text,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 100,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.plan_metrics OWNER TO postgres;

--
-- Name: regions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.regions (
    id text NOT NULL,
    org_id text,
    name text NOT NULL
);


ALTER TABLE public.regions OWNER TO postgres;

--
-- Name: report_flags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_flags (
    id text NOT NULL,
    sent_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.report_flags OWNER TO postgres;

--
-- Name: report_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.report_images (
    id bigint NOT NULL,
    store_id text,
    report_date date,
    kind text DEFAULT 'daily'::text,
    svg text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.report_images OWNER TO postgres;

--
-- Name: report_images_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.report_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.report_images_id_seq OWNER TO postgres;

--
-- Name: report_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.report_images_id_seq OWNED BY public.report_images.id;


--
-- Name: rtk_promocodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rtk_promocodes (
    id bigint NOT NULL,
    code text NOT NULL,
    note text,
    created_by bigint,
    created_by_name text,
    is_used boolean DEFAULT false NOT NULL,
    used_by bigint,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.rtk_promocodes OWNER TO postgres;

--
-- Name: rtk_promocodes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rtk_promocodes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rtk_promocodes_id_seq OWNER TO postgres;

--
-- Name: rtk_promocodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rtk_promocodes_id_seq OWNED BY public.rtk_promocodes.id;


--
-- Name: sale_metric_values; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sale_metric_values (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    store_id text NOT NULL,
    sale_date date NOT NULL,
    metric_id text NOT NULL,
    value numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.sale_metric_values OWNER TO postgres;

--
-- Name: sale_metric_values_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sale_metric_values_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sale_metric_values_id_seq OWNER TO postgres;

--
-- Name: sale_metric_values_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sale_metric_values_id_seq OWNED BY public.sale_metric_values.id;


--
-- Name: sales_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_id_seq OWNER TO postgres;

--
-- Name: sales; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales (
    id bigint DEFAULT nextval('public.sales_id_seq'::regclass) NOT NULL,
    employee_id bigint,
    store_id text,
    sale_date date NOT NULL,
    sim integer DEFAULT 0,
    mnp integer DEFAULT 0,
    pa integer DEFAULT 0,
    combo integer DEFAULT 0,
    settings numeric DEFAULT 0,
    accessories numeric DEFAULT 0,
    insurance numeric DEFAULT 0,
    phones numeric DEFAULT 0,
    wink numeric DEFAULT 0,
    shpd integer DEFAULT 0,
    focus numeric DEFAULT 0,
    credit_request integer DEFAULT 0,
    credit_issued numeric DEFAULT 0,
    plotter numeric DEFAULT 0,
    hb numeric DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    imp numeric DEFAULT 0,
    import numeric DEFAULT 0,
    esim numeric DEFAULT 0
);


ALTER TABLE public.sales OWNER TO postgres;

--
-- Name: sales_audit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_audit (
    id bigint NOT NULL,
    employee_id bigint,
    store_id text,
    sale_date date NOT NULL,
    metric text NOT NULL,
    delta numeric NOT NULL,
    source text DEFAULT 'api'::text,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.sales_audit OWNER TO postgres;

--
-- Name: sales_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_audit_id_seq OWNER TO postgres;

--
-- Name: sales_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sales_audit_id_seq OWNED BY public.sales_audit.id;


--
-- Name: sales_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_events (
    id bigint NOT NULL,
    employee_id bigint,
    store_id text,
    sale_date date NOT NULL,
    sale_hour smallint NOT NULL,
    metric text NOT NULL,
    delta numeric DEFAULT 0 NOT NULL,
    source text DEFAULT 'api'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sales_events_sale_hour_check CHECK (((sale_hour >= 0) AND (sale_hour <= 23)))
);


ALTER TABLE public.sales_events OWNER TO postgres;

--
-- Name: sales_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.sales_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sales_events_id_seq OWNER TO postgres;

--
-- Name: sales_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.sales_events_id_seq OWNED BY public.sales_events.id;


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schedules (
    id bigint NOT NULL,
    employee_id bigint,
    work_date date NOT NULL,
    store_id text,
    shift_text text,
    hours integer NOT NULL
);


ALTER TABLE public.schedules OWNER TO postgres;

--
-- Name: schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.schedules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.schedules_id_seq OWNER TO postgres;

--
-- Name: schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.schedules_id_seq OWNED BY public.schedules.id;


--
-- Name: shift_sessions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.shift_sessions (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    store_id text NOT NULL,
    work_date date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    open_lat double precision,
    open_lng double precision,
    open_accuracy_m numeric,
    close_lat double precision,
    close_lng double precision,
    self_report text,
    mood integer,
    blockers text,
    ideal_shift boolean DEFAULT false,
    score numeric,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.shift_sessions OWNER TO postgres;

--
-- Name: shift_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.shift_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shift_sessions_id_seq OWNER TO postgres;

--
-- Name: shift_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.shift_sessions_id_seq OWNED BY public.shift_sessions.id;


--
-- Name: smart_alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.smart_alerts (
    id bigint NOT NULL,
    store_id text,
    employee_id bigint,
    alert_type text NOT NULL,
    severity text DEFAULT 'warn'::text,
    title text NOT NULL,
    body text,
    payload jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now(),
    acked_at timestamp with time zone,
    acked_by bigint
);


ALTER TABLE public.smart_alerts OWNER TO postgres;

--
-- Name: smart_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.smart_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.smart_alerts_id_seq OWNER TO postgres;

--
-- Name: smart_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.smart_alerts_id_seq OWNED BY public.smart_alerts.id;


--
-- Name: store_cash; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_cash (
    id bigint NOT NULL,
    store_id text NOT NULL,
    cash_date date NOT NULL,
    cash_fact numeric DEFAULT 0 NOT NULL,
    cash_1c numeric DEFAULT 0 NOT NULL,
    comment text DEFAULT ''::text,
    created_by bigint,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.store_cash OWNER TO postgres;

--
-- Name: store_cash_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.store_cash_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.store_cash_id_seq OWNER TO postgres;

--
-- Name: store_cash_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.store_cash_id_seq OWNED BY public.store_cash.id;


--
-- Name: store_forecasts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_forecasts (
    store_id text NOT NULL,
    forecast_date date NOT NULL,
    metric text DEFAULT 'sim'::text NOT NULL,
    predicted numeric NOT NULL,
    model text DEFAULT 'dow_avg'::text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.store_forecasts OWNER TO postgres;

--
-- Name: store_hour_profile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_hour_profile (
    store_id text NOT NULL,
    dow integer NOT NULL,
    hour integer NOT NULL,
    weight numeric DEFAULT 1 NOT NULL,
    sample_count integer DEFAULT 0
);


ALTER TABLE public.store_hour_profile OWNER TO postgres;

--
-- Name: store_plans; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store_plans (
    id bigint NOT NULL,
    store_id text,
    plan_date date,
    sim integer DEFAULT 0,
    mnp integer DEFAULT 0,
    pa integer DEFAULT 0,
    combo integer DEFAULT 0,
    settings numeric DEFAULT 0,
    accessories numeric DEFAULT 0,
    insurance numeric DEFAULT 0,
    phones numeric DEFAULT 0,
    wink numeric DEFAULT 0,
    shpd integer DEFAULT 0,
    focus numeric DEFAULT 0,
    credit_request integer DEFAULT 0,
    credit_issued numeric DEFAULT 0,
    plotter numeric DEFAULT 0,
    hb numeric DEFAULT 0,
    imp numeric DEFAULT 0,
    import numeric DEFAULT 0,
    esim numeric DEFAULT 0
);


ALTER TABLE public.store_plans OWNER TO postgres;

--
-- Name: store_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.store_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.store_plans_id_seq OWNER TO postgres;

--
-- Name: store_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.store_plans_id_seq OWNED BY public.store_plans.id;


--
-- Name: stores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stores (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    short_name text NOT NULL,
    address text,
    hours integer NOT NULL,
    work_time text,
    close_time_weekday time without time zone NOT NULL,
    close_time_sunday time without time zone,
    micro_report_times text[],
    skip_sunday_micro_times text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    color text,
    plan_share numeric DEFAULT 0,
    org_id text,
    region_id text,
    lat double precision,
    lng double precision
);


ALTER TABLE public.stores OWNER TO postgres;

--
-- Name: supervisor_stores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.supervisor_stores (
    supervisor_id bigint NOT NULL,
    store_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.supervisor_stores OWNER TO postgres;

--
-- Name: support_attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_attachments (
    id bigint NOT NULL,
    ticket_id bigint NOT NULL,
    message_id bigint,
    file_url text NOT NULL,
    file_name text,
    mime text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.support_attachments OWNER TO postgres;

--
-- Name: support_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_attachments_id_seq OWNER TO postgres;

--
-- Name: support_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_attachments_id_seq OWNED BY public.support_attachments.id;


--
-- Name: support_faq; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_faq (
    id bigint NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true
);


ALTER TABLE public.support_faq OWNER TO postgres;

--
-- Name: support_faq_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_faq_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_faq_id_seq OWNER TO postgres;

--
-- Name: support_faq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_faq_id_seq OWNED BY public.support_faq.id;


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_messages (
    id bigint NOT NULL,
    ticket_id bigint,
    sender_role text,
    sender_id bigint,
    sender_name text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.support_messages OWNER TO postgres;

--
-- Name: support_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_messages_id_seq OWNER TO postgres;

--
-- Name: support_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_messages_id_seq OWNED BY public.support_messages.id;


--
-- Name: support_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_templates (
    id bigint NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    category text,
    is_active boolean DEFAULT true
);


ALTER TABLE public.support_templates OWNER TO postgres;

--
-- Name: support_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_templates_id_seq OWNER TO postgres;

--
-- Name: support_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_templates_id_seq OWNED BY public.support_templates.id;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.support_tickets (
    id bigint NOT NULL,
    employee_id bigint,
    telegram_id bigint,
    full_name text,
    category text DEFAULT 'other'::text,
    message text NOT NULL,
    status text DEFAULT 'open'::text,
    admin_reply text,
    created_at timestamp with time zone DEFAULT now(),
    answered_at timestamp with time zone,
    employee_telegram_id bigint,
    priority text DEFAULT 'normal'::text,
    sla_due_at timestamp with time zone,
    sla_minutes integer DEFAULT 240,
    first_response_at timestamp with time zone,
    resolved_at timestamp with time zone,
    sla_breached boolean DEFAULT false
);


ALTER TABLE public.support_tickets OWNER TO postgres;

--
-- Name: support_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.support_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.support_tickets_id_seq OWNER TO postgres;

--
-- Name: support_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.support_tickets_id_seq OWNED BY public.support_tickets.id;


--
-- Name: xp_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.xp_events (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    amount integer NOT NULL,
    reason text,
    ref_type text,
    ref_id text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.xp_events OWNER TO postgres;

--
-- Name: xp_events_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.xp_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.xp_events_id_seq OWNER TO postgres;

--
-- Name: xp_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.xp_events_id_seq OWNED BY public.xp_events.id;


--
-- Name: access_requests id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_requests ALTER COLUMN id SET DEFAULT nextval('public.access_requests_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: bfq_manual id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bfq_manual ALTER COLUMN id SET DEFAULT nextval('public.bfq_manual_id_seq'::regclass);


--
-- Name: bfq_questionnaires id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bfq_questionnaires ALTER COLUMN id SET DEFAULT nextval('public.bfq_questionnaires_id_seq'::regclass);


--
-- Name: channel_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channel_messages ALTER COLUMN id SET DEFAULT nextval('public.channel_messages_id_seq'::regclass);


--
-- Name: combo_calculations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_calculations ALTER COLUMN id SET DEFAULT nextval('public.combo_calculations_id_seq'::regclass);


--
-- Name: employee_badges id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_badges ALTER COLUMN id SET DEFAULT nextval('public.employee_badges_id_seq'::regclass);


--
-- Name: employee_month_plan_values id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plan_values ALTER COLUMN id SET DEFAULT nextval('public.employee_month_plan_values_id_seq'::regclass);


--
-- Name: employee_month_plans id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plans ALTER COLUMN id SET DEFAULT nextval('public.employee_month_plans_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: offline_sync_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offline_sync_log ALTER COLUMN id SET DEFAULT nextval('public.offline_sync_log_id_seq'::regclass);


--
-- Name: report_images id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_images ALTER COLUMN id SET DEFAULT nextval('public.report_images_id_seq'::regclass);


--
-- Name: rtk_promocodes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rtk_promocodes ALTER COLUMN id SET DEFAULT nextval('public.rtk_promocodes_id_seq'::regclass);


--
-- Name: sale_metric_values id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_metric_values ALTER COLUMN id SET DEFAULT nextval('public.sale_metric_values_id_seq'::regclass);


--
-- Name: sales_audit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_audit ALTER COLUMN id SET DEFAULT nextval('public.sales_audit_id_seq'::regclass);


--
-- Name: sales_events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_events ALTER COLUMN id SET DEFAULT nextval('public.sales_events_id_seq'::regclass);


--
-- Name: schedules id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules ALTER COLUMN id SET DEFAULT nextval('public.schedules_id_seq'::regclass);


--
-- Name: shift_sessions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shift_sessions ALTER COLUMN id SET DEFAULT nextval('public.shift_sessions_id_seq'::regclass);


--
-- Name: smart_alerts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.smart_alerts ALTER COLUMN id SET DEFAULT nextval('public.smart_alerts_id_seq'::regclass);


--
-- Name: store_cash id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_cash ALTER COLUMN id SET DEFAULT nextval('public.store_cash_id_seq'::regclass);


--
-- Name: store_plans id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_plans ALTER COLUMN id SET DEFAULT nextval('public.store_plans_id_seq'::regclass);


--
-- Name: support_attachments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_attachments ALTER COLUMN id SET DEFAULT nextval('public.support_attachments_id_seq'::regclass);


--
-- Name: support_faq id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_faq ALTER COLUMN id SET DEFAULT nextval('public.support_faq_id_seq'::regclass);


--
-- Name: support_messages id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_messages ALTER COLUMN id SET DEFAULT nextval('public.support_messages_id_seq'::regclass);


--
-- Name: support_templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_templates ALTER COLUMN id SET DEFAULT nextval('public.support_templates_id_seq'::regclass);


--
-- Name: support_tickets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets ALTER COLUMN id SET DEFAULT nextval('public.support_tickets_id_seq'::regclass);


--
-- Name: xp_events id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xp_events ALTER COLUMN id SET DEFAULT nextval('public.xp_events_id_seq'::regclass);


--
-- Data for Name: access_requests; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.access_requests (id, telegram_id, telegram_username, full_name, claimed_employee_id, message, status, reviewed_by, reviewed_at, created_at) FROM stdin;
1	8068147266	vim_managerwotb	Vincere Mortem | Manager WoT Blitz	\N	888967	rejected	1	2026-08-01 03:45:27.984936+00	2026-08-01 03:44:31.898821+00
2	8731583566	milibro666	Мила	5		approved	1	2026-08-01 06:43:59.480124+00	2026-08-01 06:43:44.942403+00
3	8503217170	vim_esportsdir	Vincere Mortem | eSports Director	\N		rejected	1	2026-08-01 08:20:56.229967+00	2026-08-01 08:20:22.607845+00
4	1313756513	Milenkaan	Milena	\N		approved	1	2026-08-01 12:13:23.044311+00	2026-08-01 12:13:07.347731+00
5	7641825406	user03i	­ Гагарин Илья Александрович	\N	792675	rejected	3	2026-08-01 16:07:27.693629+00	2026-08-01 16:05:46.659759+00
6	6127972373	fhydghf	Тутаев Никита Алексеевич	2	Калинина 2, Космонавтов	approved	1	2026-08-02 07:09:31.911942+00	2026-08-02 07:08:41.605008+00
\.


--
-- Data for Name: alert_flags; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.alert_flags (id, created_at) FROM stdin;
zero_sales_2026-08-01	2026-08-01 11:00:01.499358+00
store_lag_2026-08-01	2026-08-01 13:00:00.188891+00
\.


--
-- Data for Name: announcement_reads; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.announcement_reads (announcement_id, employee_id, read_at) FROM stdin;
\.


--
-- Data for Name: announcements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.announcements (id, org_id, title, body, required, active, created_by, created_at) FROM stdin;
1	\N	Проверка связи		t	t	1	2026-08-02 10:10:48.945248+00
2	\N	Проверка связи	Бабаба	t	t	1	2026-08-02 10:11:02.42844+00
3	\N	Проверка связи	Бабаба	f	t	1	2026-08-02 10:11:05.841665+00
4	\N			t	t	1	2026-08-03 21:03:44.360929+00
5	\N	прап	рпарп	f	t	1	2026-08-03 21:53:55.624074+00
\.


--
-- Data for Name: app_settings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.app_settings (key, value, updated_at) FROM stdin;
alert_zero_sales_hour	14	2026-08-01 02:29:36.784394+00
alert_store_lag_pct	40	2026-08-01 02:29:36.784394+00
app_version	6.0.0	2026-08-01 02:29:36.784394+00
\.


--
-- Data for Name: bfq_manual; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bfq_manual (id, employee_id, month, vmr_avg, penalty) FROM stdin;
\.


--
-- Data for Name: bfq_questionnaires; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bfq_questionnaires (id, employee_id, score, comment, created_at) FROM stdin;
\.


--
-- Data for Name: channel_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.channel_messages (id, channel_id, author_id, body, due_at, created_at) FROM stdin;
\.


--
-- Data for Name: channels; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.channels (id, org_id, kind, store_id, title) FROM stdin;
network	\N	network	\N	Сеть
managers	\N	managers	\N	Управляющие
store:kosmonavtov	\N	store	kosmonavtov	Космонавтов 20А
store:kalinina2	\N	store	kalinina2	Калинина 2
store:kalinina11	\N	store	kalinina11	Калинина 11
\.


--
-- Data for Name: combo_calculations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.combo_calculations (id, employee_id, phone_price, discount_pct, result, created_at) FROM stdin;
1	1	20999	35	21429.07	2026-08-01 03:04:08.114211+00
2	1	16990	20	20249.2	2026-08-01 03:05:30.788877+00
3	1	19990	25	22489.7	2026-08-01 03:59:50.108093+00
4	1	19900	25	22397	2026-08-01 08:18:23.889335+00
5	1	19990	25	22489.7	2026-08-01 11:40:39.387447+00
6	1	19999	25	22498.97	2026-08-01 11:47:52.197585+00
\.


--
-- Data for Name: employee_badges; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employee_badges (id, employee_id, badge_code, title, earned_at, meta) FROM stdin;
\.


--
-- Data for Name: employee_month_plan_values; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employee_month_plan_values (id, employee_id, month, metric_id, value) FROM stdin;
\.


--
-- Data for Name: employee_month_plans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employee_month_plans (id, employee_id, month, sim, mnp, pa, combo, phones, accessories, focus, settings, wink, shpd, insurance, credit, plotter, hb, updated_at, credit_request, credit_issued, imp, import, esim) FROM stdin;
4	5	2026-08-01	80	20	15	2	130000	30000	4000	4000	2000	3	15000	10000	1	50	2026-08-02 14:53:37.367067+00	1	10000	0	100000	0
2	3	2026-08-01	140	35	25	4	240000	60000	10000	8000	4000	5	35000	40000	3	110	2026-08-02 14:53:01.206839+00	1	40000	0	100000	0
1	4	2026-08-01	130	35	20	4	240000	60000	10000	8000	4000	5	35000	40000	3	100	2026-08-02 14:54:29.516906+00	1	40000	0	100000	0
5	6	2026-08-01	110	30	20	3	240000	50000	10000	8000	4000	5	35000	40000	3	90	2026-08-02 14:53:29.330712+00	1	40000	0	100000	0
3	1	2026-08-01	140	35	25	4	240000	60000	10000	8000	4000	5	35000	40000	3	110	2026-08-02 14:52:31.474118+00	1	40000	0	100000	0
6	2	2026-08-01	150	35	25	4	240000	60000	10000	8000	4000	5	35000	40000	3	110	2026-08-02 14:48:34.592335+00	1	40000	0	100000	0
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.employees (id, full_name, short_name, telegram_id, is_active, created_at, role, access_status, verified_by, verified_at, requested_at, org_id, level, xp, streak_days, best_shift_score, hire_date) FROM stdin;
3	Бижонов Семен Михайлович	Бижонов	1677323236	t	2026-07-28 19:48:30.742092+00	manager	active	\N	\N	\N	\N	1	0	0	0	\N
6	Степанов Алексей Юрьевич	Степанов	\N	t	2026-07-28 19:54:20.995169+00	manager	active	\N	\N	\N	\N	1	0	0	0	\N
5	Соловьёва Милана Андреевна	Соловьёва	8731583566	t	2026-07-28 19:48:30.742092+00	employee	active	1	2026-08-01 06:43:59.475708+00	\N	\N	1	0	0	0	\N
7	Milena	\N	1313756513	t	2026-08-01 12:13:23.038957+00	manager	active	1	2026-08-01 12:13:23.038957+00	\N	\N	1	0	0	0	\N
2	Тутаев Никита Алексеевич	Тутаев	6127972373	t	2026-07-28 19:48:30.742092+00	employee	active	1	2026-08-02 07:09:31.909003+00	\N	\N	1	0	0	0	\N
4	Афанасьев Аким Александрович	Афанасьев	8734381607	t	2026-07-28 19:48:30.742092+00	employee	active	\N	\N	\N	\N	1	0	0	0	\N
1	Каравашков Андрей Алексеевич	Каравашков	1123320611	t	2026-07-28 19:48:30.742092+00	admin	active	\N	\N	\N	\N	1	20	1	3	\N
\.


--
-- Data for Name: offline_sync_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.offline_sync_log (id, client_id, employee_id, telegram_id, payload, status, error, created_at) FROM stdin;
1	f1b86bce-4283-43da-b092-43888274472e	1	1123320611	{"type": "sale", "metrics": {"imp": 86999}, "store_id": "kosmonavtov", "client_id": "f1b86bce-4283-43da-b092-43888274472e", "sale_date": "2026-08-02", "created_at": "2026-08-02T14:05:21.402Z", "employee_id": 1}	applied	\N	2026-08-02 14:05:21.7796+00
2	fe1581c0-d42d-4916-b1c6-92e0604205a9	1	1123320611	{"type": "sale", "metrics": {"import": 86999}, "store_id": "kosmonavtov", "client_id": "fe1581c0-d42d-4916-b1c6-92e0604205a9", "sale_date": "2026-08-02", "created_at": "2026-08-02T14:56:39.029Z", "employee_id": 1}	applied	\N	2026-08-02 14:56:39.401958+00
\.


--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.organizations (id, name, brand_name, logo_url, theme_json, created_at) FROM stdin;
\.


--
-- Data for Name: plan_metrics; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.plan_metrics (id, label, short_label, unit, is_system, is_active, sort_order, created_at) FROM stdin;
sim	SIM	SIM	count	t	t	10	2026-08-01 02:59:12.269728+00
mnp	MNP	MNP	count	t	t	20	2026-08-01 02:59:12.269728+00
pa	ПА	ПА	count	t	t	30	2026-08-01 02:59:12.269728+00
combo	Комбо	Combo	count	t	t	40	2026-08-01 02:59:12.269728+00
phones	Телефоны	Тел	money	t	t	50	2026-08-01 02:59:12.269728+00
accessories	Аксессуары	Аксы	money	t	t	60	2026-08-01 02:59:12.269728+00
focus	ФО	ФО	money	t	t	70	2026-08-01 02:59:12.269728+00
settings	Доп услуги	Доп	money	t	t	80	2026-08-01 02:59:12.269728+00
wink	Wink	Wink	money	t	t	90	2026-08-01 02:59:12.269728+00
shpd	ШПД	ШПД	count	t	t	100	2026-08-01 02:59:12.269728+00
insurance	Страховки	Страх	money	t	t	110	2026-08-01 02:59:12.269728+00
plotter	Плоттер	Плот	count	t	t	130	2026-08-01 02:59:12.269728+00
hb	HB	HB	count	t	t	140	2026-08-01 02:59:12.269728+00
credit_request	Кредит заявка	Кр.з	count	f	t	120	2026-08-02 14:01:38.027542+00
credit_issued	Кредит выдан	Кр.в	money	f	t	130	2026-08-02 14:01:38.027542+00
import	Импорт	Import	money	f	t	150	2026-08-02 14:51:58.233637+00
esim	eSIM	eSIM	count	f	t	160	2026-08-03 21:34:55.738767+00
\.


--
-- Data for Name: regions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.regions (id, org_id, name) FROM stdin;
\.


--
-- Data for Name: report_flags; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.report_flags (id, sent_at) FROM stdin;
micro_kalinina2_2026-07-29_14:00	2026-07-29 14:00:01.019325+00
micro_kalinina11_2026-07-29_14:00	2026-07-29 14:00:01.540952+00
micro_kosmonavtov_2026-07-29_14:00	2026-07-29 14:00:02.109927+00
micro_kalinina2_2026-07-29_16:00	2026-07-29 16:00:01.117662+00
micro_kalinina11_2026-07-29_16:00	2026-07-29 16:00:01.663509+00
micro_kosmonavtov_2026-07-29_16:00	2026-07-29 16:00:02.254177+00
micro_kalinina2_2026-07-29_18:00	2026-07-29 18:00:01.105414+00
micro_kalinina11_2026-07-29_18:00	2026-07-29 18:00:01.622834+00
micro_kosmonavtov_2026-07-29_18:00	2026-07-29 18:00:02.151368+00
micro_kalinina2_2026-07-29_20:00	2026-07-29 20:00:01.104347+00
micro_kalinina11_2026-07-29_20:00	2026-07-29 20:00:01.624557+00
micro_kosmonavtov_2026-07-29_20:00	2026-07-29 20:00:02.14954+00
final_kalinina2_2026-07-29	2026-07-29 20:45:00.94902+00
final_kosmonavtov_2026-07-29	2026-07-29 21:00:00.816618+00
final_kalinina11_2026-07-29	2026-07-29 22:00:00.868013+00
micro_kalinina2_2026-07-30_10:00	2026-07-30 10:00:01.105481+00
micro_kalinina11_2026-07-30_10:00	2026-07-30 10:00:01.650803+00
micro_kalinina2_2026-07-30_12:00	2026-07-30 12:00:01.025198+00
micro_kalinina11_2026-07-30_12:00	2026-07-30 12:00:01.576213+00
micro_kosmonavtov_2026-07-30_12:00	2026-07-30 12:00:02.102944+00
micro_kalinina2_2026-07-30_14:00	2026-07-30 14:00:01.031275+00
micro_kalinina11_2026-07-30_14:00	2026-07-30 14:00:01.549234+00
micro_kosmonavtov_2026-07-30_14:00	2026-07-30 14:00:02.053468+00
micro_kalinina2_2026-07-30_16:00	2026-07-30 16:00:01.115061+00
micro_kalinina11_2026-07-30_16:00	2026-07-30 16:00:01.671851+00
micro_kosmonavtov_2026-07-30_16:00	2026-07-30 16:00:02.221903+00
micro_kalinina2_2026-07-30_18:00	2026-07-30 18:00:01.106+00
micro_kalinina11_2026-07-30_18:00	2026-07-30 18:00:01.64099+00
micro_kosmonavtov_2026-07-30_18:00	2026-07-30 18:00:02.193129+00
micro_kalinina2_2026-07-30_20:00	2026-07-30 20:00:01.101502+00
micro_kalinina11_2026-07-30_20:00	2026-07-30 20:00:01.615713+00
micro_kosmonavtov_2026-07-30_20:00	2026-07-30 20:00:02.138764+00
final_kalinina2_2026-07-30	2026-07-30 20:45:00.923041+00
final_kosmonavtov_2026-07-30	2026-07-30 21:00:00.675903+00
final_kalinina11_2026-07-30	2026-07-30 22:00:00.976429+00
micro_kalinina2_2026-07-31_10:00	2026-07-31 10:00:00.969209+00
micro_kalinina11_2026-07-31_10:00	2026-07-31 10:00:01.494594+00
micro_kalinina2_2026-07-31_12:00	2026-07-31 12:00:00.973676+00
micro_kalinina11_2026-07-31_12:00	2026-07-31 12:00:01.605832+00
micro_kosmonavtov_2026-07-31_12:00	2026-07-31 12:00:02.125519+00
micro_kalinina2_2026-07-31_14:00	2026-07-31 14:00:00.996965+00
micro_kalinina11_2026-07-31_14:00	2026-07-31 14:00:01.526368+00
micro_kosmonavtov_2026-07-31_14:00	2026-07-31 14:00:02.04743+00
micro_kalinina2_2026-07-31_16:00	2026-07-31 16:00:01.067283+00
micro_kalinina11_2026-07-31_16:00	2026-07-31 16:00:01.630843+00
micro_kosmonavtov_2026-07-31_16:00	2026-07-31 16:00:02.150522+00
micro_kalinina2_2026-07-31_18:00	2026-07-31 18:00:01.063957+00
micro_kalinina11_2026-07-31_18:00	2026-07-31 18:00:01.600004+00
micro_kosmonavtov_2026-07-31_18:00	2026-07-31 18:00:02.13105+00
micro_kalinina2_2026-07-31_20:00	2026-07-31 20:00:01.065482+00
micro_kalinina11_2026-07-31_20:00	2026-07-31 20:00:01.602123+00
micro_kosmonavtov_2026-07-31_20:00	2026-07-31 20:00:02.158258+00
final_kalinina2_2026-07-31	2026-07-31 20:45:00.92776+00
final_kosmonavtov_2026-07-31	2026-07-31 21:00:00.697893+00
final_kalinina11_2026-07-31	2026-07-31 22:00:00.973587+00
micro_kalinina11_2026-08-01_10:00	2026-08-01 07:00:01.081644+00
micro_kalinina2_2026-08-01_10:00	2026-08-01 07:00:01.609104+00
micro_kosmonavtov_2026-08-01_12:00	2026-08-01 09:00:01.137527+00
micro_kalinina11_2026-08-01_12:00	2026-08-01 09:00:01.666588+00
micro_kalinina2_2026-08-01_12:00	2026-08-01 09:00:02.174463+00
micro_kosmonavtov_2026-08-01_14:00	2026-08-01 11:00:00.956181+00
micro_kalinina11_2026-08-01_14:00	2026-08-01 11:00:01.654075+00
micro_kalinina2_2026-08-01_14:00	2026-08-01 11:00:02.183643+00
micro_kosmonavtov_2026-08-01_16:00	2026-08-01 13:00:00.528082+00
micro_kalinina11_2026-08-01_16:00	2026-08-01 13:00:01.041601+00
micro_kalinina2_2026-08-01_16:00	2026-08-01 13:00:01.569448+00
micro_kosmonavtov_2026-08-01_18:00	2026-08-01 15:00:01.0697+00
micro_kalinina11_2026-08-01_18:00	2026-08-01 15:00:01.575713+00
micro_kalinina2_2026-08-01_18:00	2026-08-01 15:00:02.078363+00
\.


--
-- Data for Name: report_images; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.report_images (id, store_id, report_date, kind, svg, created_at) FROM stdin;
\.


--
-- Data for Name: rtk_promocodes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rtk_promocodes (id, code, note, created_by, created_by_name, is_used, used_by, used_at, created_at) FROM stdin;
1	V2RTKE2Q9W	\N	1	Каравашков Андрей Алексеевич	f	\N	\N	2026-08-01 23:26:08.978693+00
2	V2RTKANPZ4	\N	1	Каравашков Андрей Алексеевич	f	\N	\N	2026-08-01 23:26:18.169715+00
3	V2RTKU4T5F	\N	1	Каравашков Андрей Алексеевич	f	\N	\N	2026-08-01 23:26:24.610961+00
4	V2RTKK87U9	\N	1	Каравашков Андрей Алексеевич	f	\N	\N	2026-08-01 23:26:32.235538+00
5	V2RTKT4CBD	\N	1	Каравашков Андрей Алексеевич	f	\N	\N	2026-08-01 23:26:39.38154+00
6	V2RTKN5YC6	\N	1	Каравашков Андрей Алексеевич	f	\N	\N	2026-08-01 23:26:46.697103+00
\.


--
-- Data for Name: sale_metric_values; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sale_metric_values (id, employee_id, store_id, sale_date, metric_id, value, updated_at) FROM stdin;
\.


--
-- Data for Name: sales; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales (id, employee_id, store_id, sale_date, sim, mnp, pa, combo, settings, accessories, insurance, phones, wink, shpd, focus, credit_request, credit_issued, plotter, hb, updated_at, imp, import, esim) FROM stdin;
39	5	kalinina2	2026-08-03	1	0	0	0	0	3290	0	0	0	0	0	0	0	0	1	2026-08-03 13:37:28.530088+00	0	0	0
12	5	kalinina2	2026-08-01	1	0	0	0	0	0	0	0	0	0	0	0	0	0	0	2026-08-01 12:36:38.722819+00	0	0	0
44	4	kosmonavtov	2026-08-03	5	1	0	0	0	0	0	0	0	0	0	0	0	0	5	2026-08-03 15:32:32.095917+00	0	0	0
41	2	kosmonavtov	2026-08-03	12	3	0	0	500	0	0	0	0	1	0	0	0	0	10	2026-08-03 16:38:41.649376+00	0	0	0
43	1	kalinina2	2026-08-03	5	1	0	0	0	10550	0	0	0	0	0	0	0	0	5	2026-08-03 17:45:58.070254+00	0	0	0
69	1	kalinina2	2026-08-04	1	1	0	0	0	0	0	0	0	0	0	0	0	0	1	2026-08-03 21:25:40.567771+00	0	0	0
1	1	kalinina2	2026-08-01	5	0	1	0	200	0	0	0	0	0	0	0	0	0	4	2026-08-01 16:18:21.988099+00	0	0	0
3	3	kosmonavtov	2026-08-01	12	3	1	0	800	1100	0	0	0	1	0	0	0	0	9	2026-08-01 16:24:09.652239+00	0	0	0
22	2	kalinina2	2026-08-02	5	1	2	0	51	0	0	0	449	0	0	0	0	0	5	2026-08-02 16:10:59.640469+00	0	0	0
24	1	kosmonavtov	2026-08-02	10	6	0	0	0	15990	0	0	0	0	0	0	0	0	8	2026-08-02 16:47:09.296263+00	86999	86999	0
\.


--
-- Data for Name: sales_audit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_audit (id, employee_id, store_id, sale_date, metric, delta, source, created_by, created_at) FROM stdin;
1	1	kalinina2	2026-08-01	sim	2	api	\N	2026-08-01 08:41:08.012608+00
2	1	kalinina2	2026-08-01	hb	1	api	\N	2026-08-01 08:41:45.460644+00
3	3	kosmonavtov	2026-08-01	sim	2	api	\N	2026-08-01 08:43:15.847575+00
4	1	kalinina2	2026-08-01	sim	1	api	\N	2026-08-01 09:20:45.891126+00
5	1	kalinina2	2026-08-01	pa	1	api	\N	2026-08-01 09:20:53.254581+00
6	1	kalinina2	2026-08-01	hb	1	api	\N	2026-08-01 09:20:59.183668+00
7	1	kalinina2	2026-08-01	sim	1	api	\N	2026-08-01 10:25:39.989056+00
8	3	kosmonavtov	2026-08-01	sim	3	api	\N	2026-08-01 12:02:46.223913+00
9	3	kosmonavtov	2026-08-01	hb	3	api	\N	2026-08-01 12:03:07.339802+00
10	3	kosmonavtov	2026-08-01	settings	800	api	\N	2026-08-01 12:03:30.482022+00
11	1	kalinina2	2026-08-01	hb	1	api	\N	2026-08-01 12:04:46.814697+00
12	5	kalinina2	2026-08-01	sim	1	api	\N	2026-08-01 12:36:38.727028+00
13	1	kalinina2	2026-08-01	sim	1	api	\N	2026-08-01 12:53:58.760843+00
14	3	kosmonavtov	2026-08-01	sim	2	api	\N	2026-08-01 13:22:12.328588+00
15	3	kosmonavtov	2026-08-01	accessories	450	api	\N	2026-08-01 13:32:25.515466+00
16	3	kosmonavtov	2026-08-01	sim	1	api	\N	2026-08-01 13:37:24.277619+00
17	3	kosmonavtov	2026-08-01	sim	2	api	\N	2026-08-01 13:53:59.36743+00
18	3	kosmonavtov	2026-08-01	sim	1	api	\N	2026-08-01 15:07:14.290816+00
19	3	kosmonavtov	2026-08-01	sim	1	api	1677323236	2026-08-01 16:05:38.95683+00
20	3	kosmonavtov	2026-08-01	hb	1	api	1677323236	2026-08-01 16:05:38.96061+00
21	1	kalinina2	2026-08-01	settings	200	api	1123320611	2026-08-01 16:18:21.993393+00
22	3	kosmonavtov	2026-08-01	shpd	1	api	1677323236	2026-08-01 16:24:09.657248+00
23	2	kalinina2	2026-08-02	sim	2	api	6127972373	2026-08-02 07:11:35.897195+00
24	2	kalinina2	2026-08-02	hb	2	api	6127972373	2026-08-02 07:11:35.899018+00
25	2	kalinina2	2026-08-02	sim	1	api	6127972373	2026-08-02 08:10:37.799204+00
26	2	kalinina2	2026-08-02	pa	1	api	6127972373	2026-08-02 08:10:37.801252+00
27	2	kalinina2	2026-08-02	hb	1	api	6127972373	2026-08-02 08:10:37.803052+00
28	1	kosmonavtov	2026-08-02	sim	2	api	1123320611	2026-08-02 08:14:31.322337+00
29	1	kosmonavtov	2026-08-02	mnp	1	api	1123320611	2026-08-02 08:14:31.324126+00
30	1	kosmonavtov	2026-08-02	hb	2	api	1123320611	2026-08-02 08:14:31.325737+00
31	2	kalinina2	2026-08-02	settings	51	api	6127972373	2026-08-02 09:26:32.359613+00
32	2	kalinina2	2026-08-02	wink	449	api	6127972373	2026-08-02 09:26:32.362333+00
33	1	kosmonavtov	2026-08-02	sim	2	api	1123320611	2026-08-02 11:33:57.240396+00
34	1	kosmonavtov	2026-08-02	mnp	1	api	1123320611	2026-08-02 11:33:57.245123+00
35	1	kosmonavtov	2026-08-02	hb	2	api	1123320611	2026-08-02 11:33:57.249858+00
36	1	kosmonavtov	2026-08-02	sim	3	api	1123320611	2026-08-02 12:00:50.177704+00
37	1	kosmonavtov	2026-08-02	mnp	3	api	1123320611	2026-08-02 12:00:50.182802+00
38	1	kosmonavtov	2026-08-02	hb	2	api	1123320611	2026-08-02 12:00:50.186982+00
39	1	kosmonavtov	2026-08-02	accessories	2990	api	1123320611	2026-08-02 12:23:46.52819+00
40	2	kalinina2	2026-08-02	sim	1	api	6127972373	2026-08-02 12:49:23.749613+00
41	2	kalinina2	2026-08-02	hb	1	api	6127972373	2026-08-02 12:49:23.752532+00
42	2	kalinina2	2026-08-02	mnp	1	api	6127972373	2026-08-02 12:49:31.981452+00
43	1	kosmonavtov	2026-08-02	sim	1	api	1123320611	2026-08-02 12:55:19.419677+00
44	1	kosmonavtov	2026-08-02	hb	1	api	1123320611	2026-08-02 12:55:19.421622+00
45	1	kosmonavtov	2026-08-02	sim	1	api	1123320611	2026-08-02 13:22:57.740381+00
46	1	kosmonavtov	2026-08-02	mnp	1	api	1123320611	2026-08-02 13:22:57.742334+00
47	1	kosmonavtov	2026-08-02	hb	1	api	1123320611	2026-08-02 13:22:57.744283+00
48	1	kosmonavtov	2026-08-02	sim	1	api	1123320611	2026-08-02 14:56:53.431078+00
49	2	kalinina2	2026-08-02	sim	1	api	6127972373	2026-08-02 16:10:59.646533+00
50	2	kalinina2	2026-08-02	pa	1	api	6127972373	2026-08-02 16:10:59.651706+00
51	2	kalinina2	2026-08-02	hb	1	api	6127972373	2026-08-02 16:10:59.656062+00
52	1	kosmonavtov	2026-08-02	accessories	15990	api	1123320611	2026-08-02 16:47:09.100533+00
53	1	kosmonavtov	2026-08-02	accessories	15990	api	1123320611	2026-08-02 16:47:09.301005+00
54	5	kalinina2	2026-08-03	accessories	1	api	8731583566	2026-08-03 06:41:44.133603+00
55	5	kalinina2	2026-08-03	accessories	499	api	8731583566	2026-08-03 06:43:41.083719+00
56	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 07:44:40.129389+00
57	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 08:32:15.091507+00
58	2	kosmonavtov	2026-08-03	settings	500	api	6127972373	2026-08-03 08:32:15.106632+00
59	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 08:32:15.110042+00
60	1	kalinina2	2026-08-03	accessories	790	api	1123320611	2026-08-03 09:02:02.040595+00
61	4	kosmonavtov	2026-08-03	sim	2	api	8734381607	2026-08-03 09:03:31.099761+00
62	4	kosmonavtov	2026-08-03	hb	2	api	8734381607	2026-08-03 09:03:31.103102+00
63	4	kosmonavtov	2026-08-03	sim	1	api	8734381607	2026-08-03 09:22:27.278985+00
64	4	kosmonavtov	2026-08-03	mnp	1	api	8734381607	2026-08-03 09:22:27.283743+00
65	4	kosmonavtov	2026-08-03	hb	1	api	8734381607	2026-08-03 09:25:59.551587+00
66	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 09:27:22.787234+00
67	2	kosmonavtov	2026-08-03	mnp	1	api	6127972373	2026-08-03 09:27:22.791036+00
68	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 09:27:22.794672+00
69	1	kalinina2	2026-08-03	accessories	2990	api	1123320611	2026-08-03 09:36:25.212596+00
70	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 10:19:28.583054+00
71	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 10:19:28.586814+00
72	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 10:19:29.524014+00
73	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 10:19:29.527676+00
74	5	kalinina2	2026-08-03	sim	1	api	8731583566	2026-08-03 10:35:07.790195+00
75	5	kalinina2	2026-08-03	hb	1	api	8731583566	2026-08-03 10:35:07.794576+00
76	2	kosmonavtov	2026-08-03	sim	2	api	6127972373	2026-08-03 11:00:09.96707+00
77	2	kosmonavtov	2026-08-03	mnp	2	api	6127972373	2026-08-03 11:00:09.975935+00
78	2	kosmonavtov	2026-08-03	shpd	1	api	6127972373	2026-08-03 11:00:09.979687+00
79	4	kosmonavtov	2026-08-03	sim	1	api	8734381607	2026-08-03 11:03:20.037504+00
80	4	kosmonavtov	2026-08-03	hb	1	api	8734381607	2026-08-03 11:03:20.041904+00
81	2	kosmonavtov	2026-08-03	hb	2	api	6127972373	2026-08-03 11:05:03.451939+00
82	5	kalinina2	2026-08-03	accessories	500	api	8731583566	2026-08-03 11:35:14.714008+00
83	5	kalinina2	2026-08-03	accessories	500	api	8731583566	2026-08-03 11:35:15.610302+00
84	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 12:12:57.6768+00
85	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 12:12:57.688093+00
86	1	kalinina2	2026-08-03	sim	1	api	1123320611	2026-08-03 13:07:18.657098+00
87	1	kalinina2	2026-08-03	hb	1	api	1123320611	2026-08-03 13:07:18.662028+00
88	1	kalinina2	2026-08-03	sim	1	api	1123320611	2026-08-03 13:26:02.362609+00
89	1	kalinina2	2026-08-03	hb	1	api	1123320611	2026-08-03 13:26:02.36884+00
90	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 13:31:20.54352+00
91	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 13:31:20.548153+00
92	5	kalinina2	2026-08-03	accessories	1790	api	8731583566	2026-08-03 13:37:28.555555+00
93	1	kalinina2	2026-08-03	accessories	5980	api	1123320611	2026-08-03 13:51:06.62887+00
94	1	kalinina2	2026-08-03	accessories	790	api	1123320611	2026-08-03 15:13:31.172007+00
95	2	kosmonavtov	2026-08-03	sim	2	api	6127972373	2026-08-03 15:22:33.65617+00
96	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 15:22:33.661348+00
97	4	kosmonavtov	2026-08-03	sim	1	api	8734381607	2026-08-03 15:32:32.100208+00
98	4	kosmonavtov	2026-08-03	hb	1	api	8734381607	2026-08-03 15:32:32.104975+00
99	2	kosmonavtov	2026-08-03	sim	1	api	6127972373	2026-08-03 16:38:41.654473+00
100	2	kosmonavtov	2026-08-03	hb	1	api	6127972373	2026-08-03 16:38:41.65916+00
101	1	kalinina2	2026-08-03	sim	1	api	1123320611	2026-08-03 17:14:51.487104+00
102	1	kalinina2	2026-08-03	hb	1	api	1123320611	2026-08-03 17:14:51.491064+00
103	1	kalinina2	2026-08-03	sim	2	api	1123320611	2026-08-03 17:45:58.076321+00
104	1	kalinina2	2026-08-03	mnp	1	api	1123320611	2026-08-03 17:45:58.081665+00
105	1	kalinina2	2026-08-03	hb	2	api	1123320611	2026-08-03 17:45:58.086139+00
106	1	kalinina2	2026-08-04	sim	1	api	1123320611	2026-08-03 21:25:40.573185+00
107	1	kalinina2	2026-08-04	mnp	1	api	1123320611	2026-08-03 21:25:40.57769+00
108	1	kalinina2	2026-08-04	hb	1	api	1123320611	2026-08-03 21:25:40.581104+00
\.


--
-- Data for Name: sales_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_events (id, employee_id, store_id, sale_date, sale_hour, metric, delta, source, created_at) FROM stdin;
1	1	kosmonavtov	2026-08-02	14	sim	2	api	2026-08-02 11:33:57.26413+00
2	1	kosmonavtov	2026-08-02	14	mnp	1	api	2026-08-02 11:33:57.27206+00
3	1	kosmonavtov	2026-08-02	14	hb	2	api	2026-08-02 11:33:57.277017+00
4	1	kosmonavtov	2026-08-02	15	sim	3	api	2026-08-02 12:00:50.191606+00
5	1	kosmonavtov	2026-08-02	15	mnp	3	api	2026-08-02 12:00:50.19596+00
6	1	kosmonavtov	2026-08-02	15	hb	2	api	2026-08-02 12:00:50.200125+00
7	1	kosmonavtov	2026-08-02	15	accessories	2990	api	2026-08-02 12:23:46.534106+00
8	2	kalinina2	2026-08-02	15	sim	1	api	2026-08-02 12:49:23.757179+00
9	2	kalinina2	2026-08-02	15	hb	1	api	2026-08-02 12:49:23.76133+00
10	2	kalinina2	2026-08-02	15	mnp	1	api	2026-08-02 12:49:31.985689+00
11	1	kosmonavtov	2026-08-02	15	sim	1	api	2026-08-02 12:55:19.423918+00
12	1	kosmonavtov	2026-08-02	15	hb	1	api	2026-08-02 12:55:19.426974+00
13	1	kosmonavtov	2026-08-02	16	sim	1	api	2026-08-02 13:22:57.746392+00
14	1	kosmonavtov	2026-08-02	16	mnp	1	api	2026-08-02 13:22:57.749715+00
15	1	kosmonavtov	2026-08-02	16	hb	1	api	2026-08-02 13:22:57.751511+00
16	1	kosmonavtov	2026-08-02	17	sim	1	api	2026-08-02 14:56:53.433968+00
17	2	kalinina2	2026-08-02	19	sim	1	api	2026-08-02 16:10:59.661276+00
18	2	kalinina2	2026-08-02	19	pa	1	api	2026-08-02 16:10:59.665791+00
19	2	kalinina2	2026-08-02	19	hb	1	api	2026-08-02 16:10:59.67123+00
20	1	kosmonavtov	2026-08-02	19	accessories	15990	api	2026-08-02 16:47:09.105736+00
21	1	kosmonavtov	2026-08-02	19	accessories	15990	api	2026-08-02 16:47:09.308809+00
22	5	kalinina2	2026-08-03	9	accessories	1	api	2026-08-03 06:41:44.141315+00
23	5	kalinina2	2026-08-03	9	accessories	499	api	2026-08-03 06:43:41.087536+00
24	2	kosmonavtov	2026-08-03	10	sim	1	api	2026-08-03 07:44:40.134181+00
25	2	kosmonavtov	2026-08-03	11	sim	1	api	2026-08-03 08:32:15.113909+00
26	2	kosmonavtov	2026-08-03	11	settings	500	api	2026-08-03 08:32:15.118154+00
27	2	kosmonavtov	2026-08-03	11	hb	1	api	2026-08-03 08:32:15.121891+00
28	1	kalinina2	2026-08-03	12	accessories	790	api	2026-08-03 09:02:02.046122+00
29	4	kosmonavtov	2026-08-03	12	sim	2	api	2026-08-03 09:03:31.106488+00
30	4	kosmonavtov	2026-08-03	12	hb	2	api	2026-08-03 09:03:31.109522+00
31	4	kosmonavtov	2026-08-03	12	sim	1	api	2026-08-03 09:22:27.294254+00
32	4	kosmonavtov	2026-08-03	12	mnp	1	api	2026-08-03 09:22:27.29851+00
33	4	kosmonavtov	2026-08-03	12	hb	1	api	2026-08-03 09:25:59.557044+00
34	2	kosmonavtov	2026-08-03	12	sim	1	api	2026-08-03 09:27:22.798675+00
35	2	kosmonavtov	2026-08-03	12	mnp	1	api	2026-08-03 09:27:22.802597+00
36	2	kosmonavtov	2026-08-03	12	hb	1	api	2026-08-03 09:27:22.807563+00
37	1	kalinina2	2026-08-03	12	accessories	2990	api	2026-08-03 09:36:25.217517+00
38	2	kosmonavtov	2026-08-03	13	sim	1	api	2026-08-03 10:19:28.590888+00
39	2	kosmonavtov	2026-08-03	13	hb	1	api	2026-08-03 10:19:28.595318+00
40	2	kosmonavtov	2026-08-03	13	sim	1	api	2026-08-03 10:19:29.532433+00
41	2	kosmonavtov	2026-08-03	13	hb	1	api	2026-08-03 10:19:29.535978+00
42	5	kalinina2	2026-08-03	13	sim	1	api	2026-08-03 10:35:07.798472+00
43	5	kalinina2	2026-08-03	13	hb	1	api	2026-08-03 10:35:07.80245+00
44	2	kosmonavtov	2026-08-03	14	sim	2	api	2026-08-03 11:00:09.983496+00
45	2	kosmonavtov	2026-08-03	14	mnp	2	api	2026-08-03 11:00:09.988434+00
46	2	kosmonavtov	2026-08-03	14	shpd	1	api	2026-08-03 11:00:09.993615+00
47	4	kosmonavtov	2026-08-03	14	sim	1	api	2026-08-03 11:03:20.045905+00
48	4	kosmonavtov	2026-08-03	14	hb	1	api	2026-08-03 11:03:20.050514+00
49	2	kosmonavtov	2026-08-03	14	hb	2	api	2026-08-03 11:05:03.456512+00
50	5	kalinina2	2026-08-03	14	accessories	500	api	2026-08-03 11:35:14.718119+00
51	5	kalinina2	2026-08-03	14	accessories	500	api	2026-08-03 11:35:15.614406+00
52	2	kosmonavtov	2026-08-03	15	sim	1	api	2026-08-03 12:12:57.699783+00
53	2	kosmonavtov	2026-08-03	15	hb	1	api	2026-08-03 12:12:57.712021+00
54	1	kalinina2	2026-08-03	16	sim	1	api	2026-08-03 13:07:18.665962+00
55	1	kalinina2	2026-08-03	16	hb	1	api	2026-08-03 13:07:18.669791+00
56	1	kalinina2	2026-08-03	16	sim	1	api	2026-08-03 13:26:02.372984+00
57	1	kalinina2	2026-08-03	16	hb	1	api	2026-08-03 13:26:02.377693+00
58	2	kosmonavtov	2026-08-03	16	sim	1	api	2026-08-03 13:31:20.552056+00
59	2	kosmonavtov	2026-08-03	16	hb	1	api	2026-08-03 13:31:20.555677+00
60	5	kalinina2	2026-08-03	16	accessories	1790	api	2026-08-03 13:37:28.560348+00
61	1	kalinina2	2026-08-03	16	accessories	5980	api	2026-08-03 13:51:06.632968+00
62	1	kalinina2	2026-08-03	18	accessories	790	api	2026-08-03 15:13:31.176778+00
63	2	kosmonavtov	2026-08-03	18	sim	2	api	2026-08-03 15:22:33.666954+00
64	2	kosmonavtov	2026-08-03	18	hb	1	api	2026-08-03 15:22:33.671801+00
65	4	kosmonavtov	2026-08-03	18	sim	1	api	2026-08-03 15:32:32.109094+00
66	4	kosmonavtov	2026-08-03	18	hb	1	api	2026-08-03 15:32:32.113298+00
67	2	kosmonavtov	2026-08-03	19	sim	1	api	2026-08-03 16:38:41.663172+00
68	2	kosmonavtov	2026-08-03	19	hb	1	api	2026-08-03 16:38:41.668207+00
69	1	kalinina2	2026-08-03	20	sim	1	api	2026-08-03 17:14:51.495245+00
70	1	kalinina2	2026-08-03	20	hb	1	api	2026-08-03 17:14:51.499441+00
71	1	kalinina2	2026-08-03	20	sim	2	api	2026-08-03 17:45:58.099863+00
72	1	kalinina2	2026-08-03	20	mnp	1	api	2026-08-03 17:45:58.115011+00
73	1	kalinina2	2026-08-03	20	hb	2	api	2026-08-03 17:45:58.125619+00
74	1	kalinina2	2026-08-04	0	sim	1	api	2026-08-03 21:25:40.585011+00
75	1	kalinina2	2026-08-04	0	mnp	1	api	2026-08-03 21:25:40.589298+00
76	1	kalinina2	2026-08-04	0	hb	1	api	2026-08-03 21:25:40.592608+00
\.


--
-- Data for Name: schedules; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.schedules (id, employee_id, work_date, store_id, shift_text, hours) FROM stdin;
7	4	2026-08-03	kosmonavtov	10-21	11
8	4	2026-08-05	kalinina2	9-21	12
9	4	2026-08-06	kosmonavtov	10-21	11
10	4	2026-08-07	kosmonavtov	10-21	11
11	4	2026-08-09	kalinina2	9-21	12
12	4	2026-08-10	kosmonavtov	10-21	11
13	4	2026-08-13	kalinina11	9-22	13
14	4	2026-08-14	kosmonavtov	10-21	11
15	4	2026-08-15	kalinina2	9-21	12
16	4	2026-08-18	kosmonavtov	10-21	11
17	4	2026-08-19	kosmonavtov	10-21	11
18	4	2026-08-20	kalinina11	9-22	13
19	4	2026-08-23	kosmonavtov	10-21	11
21	4	2026-08-24	kalinina2	9-21	12
22	4	2026-08-25	kalinina2	9-21	12
23	3	2026-08-01	kosmonavtov	10-21	11
24	3	2026-08-04	kosmonavtov	10-21	11
26	3	2026-08-05	kalinina11	9-22	13
27	3	2026-08-06	kalinina2	9-21	12
28	3	2026-08-07	kalinina11	9-22	13
29	3	2026-08-08	kalinina11	9-22	13
30	3	2026-08-11	kosmonavtov	10-21	11
31	3	2026-08-12	kalinina2	9-21	12
32	3	2026-08-13	kalinina11	9-22	13
33	3	2026-08-14	kalinina2	9-21	12
34	3	2026-08-17	kosmonavtov	10-21	11
35	3	2026-08-18	kosmonavtov	10-21	11
36	3	2026-08-19	kalinina11	9-22	13
37	3	2026-08-20	kalinina2	9-21	12
38	3	2026-08-23	kalinina11	9-22	13
39	3	2026-08-25	kosmonavtov	10-21	11
40	1	2026-08-01	kalinina2	9-21	12
42	1	2026-08-02	kosmonavtov	10-21	11
43	1	2026-08-03	kalinina2	9-21	12
45	1	2026-08-05	kosmonavtov	10-21	11
46	1	2026-08-07	kalinina2	9-21	12
47	1	2026-08-08	kalinina2	9-21	12
48	1	2026-08-09	kosmonavtov	10-21	11
49	1	2026-08-10	kalinina2	9-21	12
50	1	2026-08-13	kosmonavtov	10-21	11
51	1	2026-08-14	kalinina11	9-22	13
52	1	2026-08-17	kalinina11	9-22	13
53	1	2026-08-19	kosmonavtov	10-21	11
54	1	2026-08-20	kalinina11	9-22	13
55	1	2026-08-22	kalinina2	9-21	12
56	1	2026-08-24	kalinina11	9-22	13
57	1	2026-08-25	kosmonavtov	10-21	11
58	5	2026-08-01	kalinina2	9-21	12
60	5	2026-08-03	kalinina2	9-21	12
61	4	2026-08-26	kosmonavtov	10-21	11
62	4	2026-08-29	kosmonavtov	10-21	11
63	4	2026-08-30	kalinina2	9-21	12
64	4	2026-08-31	kalinina2	9-21	12
65	3	2026-08-26	kalinina11	9-22	13
66	3	2026-08-27	kalinina2	9-21	12
67	3	2026-08-30	kosmonavtov	10-21	11
68	3	2026-08-31	kalinina11	9-22	13
69	1	2026-08-28	kalinina11	9-22	13
70	1	2026-08-29	kalinina2	9-21	12
71	6	2026-08-11	kalinina11	9-22	13
72	6	2026-08-12	kosmonavtov	10-21	11
73	6	2026-08-13	kalinina2	9-21	12
74	6	2026-08-14	kosmonavtov	10-21	11
75	6	2026-08-15	kalinina11	9-22	13
76	6	2026-08-18	kalinina2	9-21	12
77	6	2026-08-19	kalinina2	9-21	12
78	6	2026-08-20	kosmonavtov	10-21	11
79	6	2026-08-21	kalinina11	9-22	13
80	6	2026-08-22	kosmonavtov	10-21	11
81	6	2026-08-25	kalinina11	9-22	13
82	6	2026-08-26	kalinina2	9-21	12
83	6	2026-08-27	kosmonavtov	10-21	11
84	6	2026-08-30	kalinina11	9-22	13
85	6	2026-08-31	kosmonavtov	10-21	11
86	2	2026-08-02	kalinina2	9-21	12
87	2	2026-08-03	kosmonavtov	10-21	11
89	2	2026-08-06	kosmonavtov	10-21	11
90	2	2026-08-07	kosmonavtov	10-21	11
91	2	2026-08-08	kosmonavtov	10-21	11
92	2	2026-08-11	kalinina2	9-21	12
93	2	2026-08-12	kalinina11	9-22	13
94	2	2026-08-15	kosmonavtov	10-21	11
95	2	2026-08-16	kalinina2	9-21	12
96	2	2026-08-17	kalinina2	9-21	12
97	2	2026-08-18	kalinina11	9-22	13
98	2	2026-08-21	kosmonavtov	10-21	11
99	2	2026-08-22	kalinina11	9-22	13
100	2	2026-08-23	kalinina2	9-21	12
101	2	2026-08-24	kosmonavtov	10-21	11
102	2	2026-08-27	kalinina11	9-22	13
103	2	2026-08-28	kosmonavtov	10-21	11
104	2	2026-08-29	kalinina11	9-22	13
105	5	2026-08-04	kosmonavtov	10-21	11
106	5	2026-08-06	kalinina2	9-21	12
107	5	2026-08-07	kalinina2	9-21	12
108	5	2026-08-10	kosmonavtov	10-21	11
109	5	2026-08-11	kalinina11	9-22	13
110	5	2026-08-12	kosmonavtov	10-21	11
111	5	2026-08-16	kosmonavtov	10-21	11
112	5	2026-08-17	kalinina11	9-22	13
113	5	2026-08-21	kalinina2	9-21	12
114	5	2026-08-22	kalinina11	9-22	13
115	5	2026-08-24	kosmonavtov	10-21	11
116	5	2026-08-25	kalinina11	9-22	13
117	5	2026-08-28	kalinina2	9-21	12
118	5	2026-08-29	kosmonavtov	10-21	11
88	2	2026-08-04	kalinina2	10-21	11
\.


--
-- Data for Name: shift_sessions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.shift_sessions (id, employee_id, store_id, work_date, status, opened_at, closed_at, open_lat, open_lng, open_accuracy_m, close_lat, close_lng, self_report, mood, blockers, ideal_shift, score, created_at) FROM stdin;
2	2	kalinina2	2026-08-02	open	2026-08-02 07:27:25.620109+00	\N	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	2026-08-02 07:27:25.620109+00
1	1	kosmonavtov	2026-08-02	auto_closed	2026-08-02 07:03:09.055083+00	2026-08-03 06:25:51.577604+00	55.91338023955163	37.86736958512272	12.009794724311726	\N	\N	\N	\N	\N	f	\N	2026-08-02 07:03:09.055083+00
5	4	kosmonavtov	2026-08-03	open	2026-08-03 09:03:02.466954+00	\N	55.914366	37.8665481	12.710000038146973	\N	\N	\N	\N	\N	f	\N	2026-08-03 09:03:02.466954+00
4	5	kalinina2	2026-08-03	auto_closed	2026-08-03 06:26:12.472272+00	2026-08-03 17:51:57.02626+00	55.92459129091341	37.8161986323686	91.54691034277727	\N	\N	\N	\N	\N	f	\N	2026-08-03 06:26:12.472272+00
6	5	kalinina2	2026-08-03	open	2026-08-03 17:51:57.031415+00	\N	55.92451772932036	37.81616378641987	33.995014	\N	\N	\N	\N	\N	f	\N	2026-08-03 17:51:57.031415+00
3	1	kalinina2	2026-08-03	auto_closed	2026-08-03 06:25:51.582793+00	2026-08-03 21:56:14.84563+00	55.92447777328953	37.81570678040355	9.96878032470411	\N	\N	\N	\N	\N	f	\N	2026-08-03 06:25:51.582793+00
7	1	kosmonavtov	2026-08-04	auto_closed	2026-08-03 21:56:14.857541+00	2026-08-03 21:56:16.335009+00	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	2026-08-03 21:56:14.857541+00
8	1	kosmonavtov	2026-08-04	auto_closed	2026-08-03 21:56:16.340072+00	2026-08-03 21:56:16.601851+00	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	2026-08-03 21:56:16.340072+00
9	1	kosmonavtov	2026-08-04	auto_closed	2026-08-03 21:56:16.605637+00	2026-08-03 21:56:17.044205+00	\N	\N	\N	\N	\N	\N	\N	\N	f	\N	2026-08-03 21:56:16.605637+00
10	1	kosmonavtov	2026-08-04	closed	2026-08-03 21:56:17.048472+00	2026-08-03 22:14:07.925505+00	\N	\N	\N	\N	\N	\N	4	\N	f	3	2026-08-03 21:56:17.048472+00
\.


--
-- Data for Name: smart_alerts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.smart_alerts (id, store_id, employee_id, alert_type, severity, title, body, payload, status, created_at, acked_at, acked_by) FROM stdin;
1	kalinina2	\N	cash_gap	warn	Калинина 2: расхождение кассы 1402	Факт 16052 vs 1С 14650	{"date": "2026-08-02", "delta": 1402}	open	2026-08-02 17:25:27.464834+00	\N	\N
2	kosmonavtov	\N	cash_gap	critical	Космонавтов 20А: расхождение кассы -14893	Факт 15897 vs 1С 30790	{"date": "2026-08-02", "delta": -14893}	open	2026-08-02 17:55:27.453501+00	\N	\N
3	kalinina2	\N	no_sales_hour	critical	Калинина 2: тишина до 13:00	Смена открыта, продаж нет. Загляни на точку или напиши смене.	{"date": "2026-08-03", "hour": 13}	open	2026-08-03 10:21:00.874905+00	\N	\N
4	kalinina2	\N	low_mnp_ratio	warn	Калинина 2: 0 MNP при 4 SIM	К 20:00 на точке 4 SIM и ни одного MNP — нетипично. Проверьте скрипт переноса.	{"mnp": 0, "sim": 4, "date": "2026-08-03", "hour": 20}	open	2026-08-03 17:21:01.079776+00	\N	\N
5	kosmonavtov	\N	cash_gap	critical	Космонавтов 20А: расхождение кассы -14893	Факт 23052 vs 1С 37945	{"date": "2026-08-03", "delta": -14893}	open	2026-08-03 18:21:01.061495+00	\N	\N
6	kalinina2	\N	cash_gap	warn	Калинина 2: расхождение кассы 1412	Факт 24252 vs 1С 22840	{"date": "2026-08-03", "delta": 1412}	open	2026-08-03 18:21:01.080225+00	\N	\N
\.


--
-- Data for Name: store_cash; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_cash (id, store_id, cash_date, cash_fact, cash_1c, comment, created_by, updated_at) FROM stdin;
2	kosmonavtov	2026-08-01	10797	25700	17 тысяч в кассе долив имейте ввиду 	\N	2026-08-01 17:48:23.662293+00
3	kalinina2	2026-08-01	13752	12350	\N	\N	2026-08-01 17:52:36.538773+00
4	kalinina2	2026-08-02	16052	14650	\N	\N	2026-08-02 16:52:04.72263+00
5	kosmonavtov	2026-08-02	15897	30790	\N	\N	2026-08-02 17:46:09.132114+00
6	kalinina2	2026-08-03	24252	22840	\N	\N	2026-08-03 18:05:10.698306+00
7	kosmonavtov	2026-08-03	23052	37945	\N	\N	2026-08-03 18:05:41.301003+00
\.


--
-- Data for Name: store_forecasts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_forecasts (store_id, forecast_date, metric, predicted, model, created_at) FROM stdin;
\.


--
-- Data for Name: store_hour_profile; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_hour_profile (store_id, dow, hour, weight, sample_count) FROM stdin;
\.


--
-- Data for Name: store_plans; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.store_plans (id, store_id, plan_date, sim, mnp, pa, combo, settings, accessories, insurance, phones, wink, shpd, focus, credit_request, credit_issued, plotter, hb, imp, import, esim) FROM stdin;
2	kalinina2	\N	9	4	2	1	1000	3000	3000	15000	500	1	2000	1	15000	0	0	0	0	0
3	kalinina11	\N	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0	0
1	kosmonavtov	\N	18	8	3	1	1000	3000	3000	15000	500	1	2000	1	15000	0	0	0	0	0
10	kalinina11	2026-08-01	8	3	2	1	419	3093	1839	12872	213	1	523	0	2033	1	6	0	0	0
11	kalinina2	2026-08-01	5	2	1	1	279	2062	1226	8581	142	1	349	0	1355	1	4	0	0	0
12	kosmonavtov	2026-08-01	12	4	3	1	697	5155	3065	21452	355	1	871	0	3388	1	10	0	0	0
31	kalinina11	2026-08-02	5	2	1	1	287	2107	1267	8867	144	1	360	1	1400	1	4	0	0	0
32	kalinina2	2026-08-02	6	2	2	1	358	2633	1584	11084	180	1	450	1	1750	1	5	0	0	0
33	kosmonavtov	2026-08-02	14	4	3	1	788	5793	3484	24384	396	1	991	1	3851	1	11	0	0	0
37	kalinina11	2026-08-04	5	2	1	1	304	2065	1358	9500	154	1	386	1	1500	1	4	0	0	0
38	kalinina2	2026-08-04	7	2	2	1	380	2581	1697	11875	193	1	483	1	1875	1	5	0	0	0
39	kosmonavtov	2026-08-04	14	4	3	1	835	5679	3733	26126	424	1	1061	1	4125	1	11	0	0	0
\.


--
-- Data for Name: stores; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stores (id, code, name, short_name, address, hours, work_time, close_time_weekday, close_time_sunday, micro_report_times, skip_sunday_micro_times, is_active, created_at, color, plan_share, org_id, region_id, lat, lng) FROM stdin;
kosmonavtov	1017607	Космонавтов 20А	Космонавтов	МО, Королёв, Космонавтов пр-т, 20а *Теле2*	11	10-21	21:00:00	21:00:00	{12:00,14:00,16:00,18:00,20:00}	\N	t	2026-07-28 18:50:39.092979+00	#6d9eeb	0.50	\N	\N	\N	\N
kalinina11	203068	Калинина 11	Калинина 11	МО, Королёв, Калинина, 11 *Теле2*	13	9-22	22:00:00	22:00:00	{10:00,12:00,14:00,16:00,18:00,20:00}	\N	t	2026-07-28 18:50:39.092979+00	#ffd966	0.30	\N	\N	\N	\N
kalinina2	888967	Калинина 2	Калинина	МО, Королёв, Калинина, 2 *Теле2*	12	9-21	20:45:00	19:45:00	{10:00,12:00,14:00,16:00,18:00,20:00}	{20:00}	t	2026-07-28 18:50:39.092979+00	#ff6d01	0.20	\N	\N	\N	\N
\.


--
-- Data for Name: supervisor_stores; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.supervisor_stores (supervisor_id, store_id, created_at) FROM stdin;
\.


--
-- Data for Name: support_attachments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_attachments (id, ticket_id, message_id, file_url, file_name, mime, created_at) FROM stdin;
\.


--
-- Data for Name: support_faq; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_faq (id, keywords, question, answer, sort_order, is_active) FROM stdin;
1	{график,смена,"когда работаю"}	Как посмотреть график?	Открой вкладку «График» в приложении. Там календарь на месяц и кто на какой точке.	1	t
2	{продажа,добавить,внести}	Как добавить продажу?	Нажми «+» внизу экрана, выбери метрику и количество. Точка подставится из графика.	2	t
3	{план,цифры,норма}	Где мой план?	Вкладка «Мой» — личный план на день. «План» — план по всем точкам.	3	t
4	{bfq,рейтинг}	Что такое BFQ?	BFQ — показатель качества и выполнения плана. Смотри во вкладке BFQ (Команда → BFQ).	4	t
5	{ошибка,баг,"не работает"}	Что-то сломалось	Опиши проблему в поддержке — сообщение уйдёт администратору. Или закрой и открой приложение заново.	5	t
\.


--
-- Data for Name: support_messages; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_messages (id, ticket_id, sender_role, sender_id, sender_name, body, created_at) FROM stdin;
1	2	admin	1	Каравашков Андрей Алексеевич	Ало	2026-08-01 15:54:50.135723+00
2	1	admin	1	Каравашков Андрей Алексеевич	Ало	2026-08-01 15:54:54.815046+00
\.


--
-- Data for Name: support_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_templates (id, title, body, category, is_active) FROM stdin;
\.


--
-- Data for Name: support_tickets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.support_tickets (id, employee_id, telegram_id, full_name, category, message, status, admin_reply, created_at, answered_at, employee_telegram_id, priority, sla_due_at, sla_minutes, first_response_at, resolved_at, sla_breached) FROM stdin;
5	\N	7082339160	Vincere Mortem | Support	other	Проблема	answered	жопа	2026-08-01 02:43:22.689511+00	2026-08-01 02:44:00.733427+00	\N	normal	2026-08-01 06:43:22.689511+00	240	\N	\N	f
4	1	1123320611	Каравашков Андрей Алексеевич	other	саси	answered	Хуй	2026-08-01 02:09:18.39068+00	2026-08-01 07:37:27.484027+00	\N	normal	2026-08-01 06:09:18.39068+00	240	\N	\N	f
3	1	1123320611	Каравашков Андрей Алексеевич	other	бля	answered	Не работает пиши путину	2026-08-01 02:09:08.538499+00	2026-08-01 08:09:27.378572+00	\N	normal	2026-08-01 06:09:08.538499+00	240	\N	\N	f
6	1	1123320611	Каравашков Андрей Алексеевич	other	Хуй	answered	Хуй	2026-08-01 08:19:21.737746+00	2026-08-01 08:19:41.581465+00	\N	normal	2026-08-01 12:19:21.737746+00	240	\N	\N	f
7	5	8731583566	Соловьёва Милана Андреевна	other	ГДЕ МОЙ ГРАФИК	answered	Открой вкладку «График» в приложении. Там календарь на месяц и кто на какой точке.	2026-08-01 09:54:22.650455+00	2026-08-01 09:54:22.65+00	\N	normal	2026-08-01 13:54:22.650455+00	240	\N	\N	f
8	5	8731583566	Соловьёва Милана Андреевна	other	ГРЫИК СУКА	answered	уволена	2026-08-01 09:54:39.383509+00	2026-08-01 09:55:01.959657+00	\N	normal	2026-08-01 13:54:39.383509+00	240	\N	\N	f
2	1	1123320611	Каравашков Андрей Алексеевич	other	алабуга	answered	Ало	2026-08-01 01:26:09.955378+00	2026-08-01 15:54:50.131634+00	\N	normal	2026-08-01 05:26:09.955378+00	240	\N	\N	f
1	1	1123320611	Каравашков Андрей Алексеевич	other	алабуга	answered	Ало	2026-08-01 01:26:09.071147+00	2026-08-01 15:54:54.81087+00	\N	normal	2026-08-01 05:26:09.071147+00	240	\N	\N	f
\.


--
-- Data for Name: xp_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.xp_events (id, employee_id, amount, reason, ref_type, ref_id, created_at) FROM stdin;
1	1	20	shift_close	\N	\N	2026-08-03 22:14:07.932496+00
\.


--
-- Name: access_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.access_requests_id_seq', 6, true);


--
-- Name: announcements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.announcements_id_seq', 5, true);


--
-- Name: bfq_manual_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bfq_manual_id_seq', 1, false);


--
-- Name: bfq_questionnaires_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bfq_questionnaires_id_seq', 1, false);


--
-- Name: channel_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.channel_messages_id_seq', 1, false);


--
-- Name: combo_calculations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.combo_calculations_id_seq', 6, true);


--
-- Name: employee_badges_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_badges_id_seq', 1, false);


--
-- Name: employee_month_plan_values_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_month_plan_values_id_seq', 1, false);


--
-- Name: employee_month_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employee_month_plans_id_seq', 38, true);


--
-- Name: employees_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.employees_id_seq', 7, true);


--
-- Name: offline_sync_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.offline_sync_log_id_seq', 2, true);


--
-- Name: report_images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.report_images_id_seq', 1, false);


--
-- Name: rtk_promocodes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rtk_promocodes_id_seq', 6, true);


--
-- Name: sale_metric_values_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sale_metric_values_id_seq', 1, false);


--
-- Name: sales_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_audit_id_seq', 108, true);


--
-- Name: sales_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_events_id_seq', 76, true);


--
-- Name: sales_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.sales_id_seq', 69, true);


--
-- Name: schedules_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.schedules_id_seq', 120, true);


--
-- Name: shift_sessions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.shift_sessions_id_seq', 10, true);


--
-- Name: smart_alerts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.smart_alerts_id_seq', 6, true);


--
-- Name: store_cash_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.store_cash_id_seq', 7, true);


--
-- Name: store_plans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.store_plans_id_seq', 39, true);


--
-- Name: support_attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_attachments_id_seq', 1, false);


--
-- Name: support_faq_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_faq_id_seq', 5, true);


--
-- Name: support_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_messages_id_seq', 2, true);


--
-- Name: support_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_templates_id_seq', 1, false);


--
-- Name: support_tickets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.support_tickets_id_seq', 8, true);


--
-- Name: xp_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.xp_events_id_seq', 1, true);


--
-- Name: access_requests access_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.access_requests
    ADD CONSTRAINT access_requests_pkey PRIMARY KEY (id);


--
-- Name: alert_flags alert_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alert_flags
    ADD CONSTRAINT alert_flags_pkey PRIMARY KEY (id);


--
-- Name: announcement_reads announcement_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY (announcement_id, employee_id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: bfq_manual bfq_manual_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bfq_manual
    ADD CONSTRAINT bfq_manual_pkey PRIMARY KEY (id);


--
-- Name: bfq_questionnaires bfq_questionnaires_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bfq_questionnaires
    ADD CONSTRAINT bfq_questionnaires_pkey PRIMARY KEY (id);


--
-- Name: channel_messages channel_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: combo_calculations combo_calculations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.combo_calculations
    ADD CONSTRAINT combo_calculations_pkey PRIMARY KEY (id);


--
-- Name: employee_badges employee_badges_employee_id_badge_code_earned_at_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_badges
    ADD CONSTRAINT employee_badges_employee_id_badge_code_earned_at_key UNIQUE (employee_id, badge_code, earned_at);


--
-- Name: employee_badges employee_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_badges
    ADD CONSTRAINT employee_badges_pkey PRIMARY KEY (id);


--
-- Name: employee_month_plan_values employee_month_plan_values_employee_id_month_metric_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plan_values
    ADD CONSTRAINT employee_month_plan_values_employee_id_month_metric_id_key UNIQUE (employee_id, month, metric_id);


--
-- Name: employee_month_plan_values employee_month_plan_values_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plan_values
    ADD CONSTRAINT employee_month_plan_values_pkey PRIMARY KEY (id);


--
-- Name: employee_month_plans employee_month_plans_employee_id_month_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plans
    ADD CONSTRAINT employee_month_plans_employee_id_month_key UNIQUE (employee_id, month);


--
-- Name: employee_month_plans employee_month_plans_employee_month_uq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plans
    ADD CONSTRAINT employee_month_plans_employee_month_uq UNIQUE (employee_id, month);


--
-- Name: employee_month_plans employee_month_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plans
    ADD CONSTRAINT employee_month_plans_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: offline_sync_log offline_sync_log_client_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offline_sync_log
    ADD CONSTRAINT offline_sync_log_client_id_key UNIQUE (client_id);


--
-- Name: offline_sync_log offline_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.offline_sync_log
    ADD CONSTRAINT offline_sync_log_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: plan_metrics plan_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_metrics
    ADD CONSTRAINT plan_metrics_pkey PRIMARY KEY (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: report_images report_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_pkey PRIMARY KEY (id);


--
-- Name: rtk_promocodes rtk_promocodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rtk_promocodes
    ADD CONSTRAINT rtk_promocodes_pkey PRIMARY KEY (id);


--
-- Name: sale_metric_values sale_metric_values_employee_id_store_id_sale_date_metric_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_metric_values
    ADD CONSTRAINT sale_metric_values_employee_id_store_id_sale_date_metric_id_key UNIQUE (employee_id, store_id, sale_date, metric_id);


--
-- Name: sale_metric_values sale_metric_values_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_metric_values
    ADD CONSTRAINT sale_metric_values_pkey PRIMARY KEY (id);


--
-- Name: sales_audit sales_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_audit
    ADD CONSTRAINT sales_audit_pkey PRIMARY KEY (id);


--
-- Name: sales sales_employee_store_date_uq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_employee_store_date_uq UNIQUE (employee_id, store_id, sale_date);


--
-- Name: sales_events sales_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_events
    ADD CONSTRAINT sales_events_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_employee_date_uq; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_employee_date_uq UNIQUE (employee_id, work_date);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: shift_sessions shift_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.shift_sessions
    ADD CONSTRAINT shift_sessions_pkey PRIMARY KEY (id);


--
-- Name: smart_alerts smart_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.smart_alerts
    ADD CONSTRAINT smart_alerts_pkey PRIMARY KEY (id);


--
-- Name: store_cash store_cash_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_cash
    ADD CONSTRAINT store_cash_pkey PRIMARY KEY (id);


--
-- Name: store_cash store_cash_store_id_cash_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_cash
    ADD CONSTRAINT store_cash_store_id_cash_date_key UNIQUE (store_id, cash_date);


--
-- Name: store_forecasts store_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_forecasts
    ADD CONSTRAINT store_forecasts_pkey PRIMARY KEY (store_id, forecast_date, metric);


--
-- Name: store_hour_profile store_hour_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store_hour_profile
    ADD CONSTRAINT store_hour_profile_pkey PRIMARY KEY (store_id, dow, hour);


--
-- Name: supervisor_stores supervisor_stores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.supervisor_stores
    ADD CONSTRAINT supervisor_stores_pkey PRIMARY KEY (supervisor_id, store_id);


--
-- Name: support_attachments support_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_attachments
    ADD CONSTRAINT support_attachments_pkey PRIMARY KEY (id);


--
-- Name: support_faq support_faq_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_faq
    ADD CONSTRAINT support_faq_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_templates support_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_templates
    ADD CONSTRAINT support_templates_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: xp_events xp_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.xp_events
    ADD CONSTRAINT xp_events_pkey PRIMARY KEY (id);


--
-- Name: idx_access_req_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_access_req_status ON public.access_requests USING btree (status, created_at DESC);


--
-- Name: idx_access_req_tg_pending; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_access_req_tg_pending ON public.access_requests USING btree (telegram_id) WHERE (status = 'pending'::text);


--
-- Name: idx_bfq_q_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bfq_q_employee ON public.bfq_questionnaires USING btree (employee_id, created_at);


--
-- Name: idx_emp_month_plans_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_emp_month_plans_month ON public.employee_month_plans USING btree (month);


--
-- Name: idx_employees_telegram; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_employees_telegram ON public.employees USING btree (telegram_id);


--
-- Name: idx_rtk_promos_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rtk_promos_active ON public.rtk_promocodes USING btree (is_used, created_at DESC) WHERE (is_used = false);


--
-- Name: idx_sales_audit_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_audit_date ON public.sales_audit USING btree (sale_date);


--
-- Name: idx_sales_audit_employee; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_audit_employee ON public.sales_audit USING btree (employee_id, sale_date);


--
-- Name: idx_sales_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_date ON public.sales USING btree (sale_date);


--
-- Name: idx_sales_employee_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_employee_date ON public.sales USING btree (employee_id, sale_date);


--
-- Name: idx_sales_events_hour; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_events_hour ON public.sales_events USING btree (store_id, sale_hour);


--
-- Name: idx_sales_events_store_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sales_events_store_date ON public.sales_events USING btree (store_id, sale_date);


--
-- Name: idx_schedules_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_schedules_date ON public.schedules USING btree (work_date);


--
-- Name: idx_shift_sessions_emp_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shift_sessions_emp_date ON public.shift_sessions USING btree (employee_id, work_date);


--
-- Name: idx_shift_sessions_store_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_shift_sessions_store_open ON public.shift_sessions USING btree (store_id, status) WHERE (status = 'open'::text);


--
-- Name: idx_smart_alerts_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_smart_alerts_open ON public.smart_alerts USING btree (status, created_at DESC);


--
-- Name: idx_store_cash_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_store_cash_date ON public.store_cash USING btree (cash_date);


--
-- Name: idx_supervisor_stores_store; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_supervisor_stores_store ON public.supervisor_stores USING btree (store_id);


--
-- Name: idx_support_messages_ticket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_messages_ticket ON public.support_messages USING btree (ticket_id);


--
-- Name: idx_support_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_open ON public.support_tickets USING btree (status, created_at DESC);


--
-- Name: idx_support_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_support_status ON public.support_tickets USING btree (status, created_at DESC);


--
-- Name: uq_bfq_manual_emp_month; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_bfq_manual_emp_month ON public.bfq_manual USING btree (employee_id, month);


--
-- Name: announcement_reads announcement_reads_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: channel_messages channel_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);


--
-- Name: employee_month_plan_values employee_month_plan_values_metric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.employee_month_plan_values
    ADD CONSTRAINT employee_month_plan_values_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES public.plan_metrics(id);


--
-- Name: regions regions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: sale_metric_values sale_metric_values_metric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sale_metric_values
    ADD CONSTRAINT sale_metric_values_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES public.plan_metrics(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict ZB8h0OoErmjOK9KqJ7Hf9TkE2ue2fuht0eYjbu6pF6b6RoPcDKyxNk7zup3SsYH

--
-- PostgreSQL database cluster dump complete
--

