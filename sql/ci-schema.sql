--
-- PostgreSQL database dump
--

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.4

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_requests; Type: TABLE; Schema: public; Owner: -
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
    created_at timestamp with time zone DEFAULT now(),
    org_id text
);


--
-- Name: access_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.access_requests_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: access_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.access_requests_id_seq OWNED BY public.access_requests.id;


--
-- Name: ai_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_audit (
    id bigint NOT NULL,
    kind text NOT NULL,
    employee_id integer,
    store_id text,
    ref_date date,
    prompt text,
    response text NOT NULL,
    model text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_audit_id_seq OWNED BY public.ai_audit.id;


--
-- Name: alert_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alert_flags (
    id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: announcement_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_reads (
    announcement_id bigint NOT NULL,
    employee_id bigint NOT NULL,
    read_at timestamp with time zone DEFAULT now()
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: bfq_manual; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bfq_manual (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    month date NOT NULL,
    vmr_avg numeric DEFAULT 0,
    penalty numeric DEFAULT 0
);


--
-- Name: bfq_manual_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bfq_manual_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bfq_manual_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bfq_manual_id_seq OWNED BY public.bfq_manual.id;


--
-- Name: bfq_questionnaires; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bfq_questionnaires (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    score numeric NOT NULL,
    comment text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bfq_questionnaires_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bfq_questionnaires_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bfq_questionnaires_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bfq_questionnaires_id_seq OWNED BY public.bfq_questionnaires.id;


--
-- Name: channel_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_messages (
    id bigint NOT NULL,
    channel_id text NOT NULL,
    author_id bigint,
    body text NOT NULL,
    due_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: channel_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.channel_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: channel_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.channel_messages_id_seq OWNED BY public.channel_messages.id;


--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channels (
    id text NOT NULL,
    org_id text,
    kind text NOT NULL,
    store_id text,
    title text NOT NULL
);


--
-- Name: combo_calculations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combo_calculations (
    id bigint NOT NULL,
    employee_id bigint,
    phone_price numeric NOT NULL,
    discount_pct integer NOT NULL,
    result numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: combo_calculations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.combo_calculations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: combo_calculations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.combo_calculations_id_seq OWNED BY public.combo_calculations.id;


--
-- Name: employee_badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_badges (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    badge_code text NOT NULL,
    title text,
    earned_at timestamp with time zone DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb
);


--
-- Name: employee_badges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_badges_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_badges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_badges_id_seq OWNED BY public.employee_badges.id;


--
-- Name: employee_month_plan_values; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_month_plan_values (
    id bigint NOT NULL,
    employee_id bigint NOT NULL,
    month date NOT NULL,
    metric_id text NOT NULL,
    value numeric DEFAULT 0 NOT NULL
);


--
-- Name: employee_month_plan_values_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_month_plan_values_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_month_plan_values_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_month_plan_values_id_seq OWNED BY public.employee_month_plan_values.id;


--
-- Name: employee_month_plans; Type: TABLE; Schema: public; Owner: -
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
    esim numeric DEFAULT 0,
    tst numeric DEFAULT 0
);


--
-- Name: employee_month_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_month_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employee_month_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employee_month_plans_id_seq OWNED BY public.employee_month_plans.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employees_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: offline_sync_log; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: offline_sync_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.offline_sync_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: offline_sync_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.offline_sync_log_id_seq OWNED BY public.offline_sync_log.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id text NOT NULL,
    name text NOT NULL,
    brand_name text,
    logo_url text,
    theme_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    sector_id text,
    chat_id text,
    primary_color text DEFAULT '#2AABEE'::text,
    is_active boolean DEFAULT true,
    sales_thread_id text,
    reports_thread_id text
);


--
-- Name: plan_metrics; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: regions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.regions (
    id text NOT NULL,
    org_id text,
    name text NOT NULL
);


--
-- Name: report_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_flags (
    id text NOT NULL,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: report_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_images (
    id bigint NOT NULL,
    store_id text,
    report_date date,
    kind text DEFAULT 'daily'::text,
    svg text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: report_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.report_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: report_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.report_images_id_seq OWNED BY public.report_images.id;


--
-- Name: rtk_promocodes; Type: TABLE; Schema: public; Owner: -
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
    created_at timestamp with time zone DEFAULT now(),
    org_id text
);


--
-- Name: rtk_promocodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rtk_promocodes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rtk_promocodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rtk_promocodes_id_seq OWNED BY public.rtk_promocodes.id;


--
-- Name: sale_metric_values; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: sale_metric_values_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sale_metric_values_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sale_metric_values_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sale_metric_values_id_seq OWNED BY public.sale_metric_values.id;


--
-- Name: sales_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales; Type: TABLE; Schema: public; Owner: -
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
    esim numeric DEFAULT 0,
    tst numeric DEFAULT 0
);


--
-- Name: sales_audit; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: sales_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_audit_id_seq OWNED BY public.sales_audit.id;


--
-- Name: sales_events; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: sales_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sales_events_id_seq OWNED BY public.sales_events.id;


--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id bigint NOT NULL,
    employee_id bigint,
    work_date date NOT NULL,
    store_id text,
    shift_text text,
    hours integer NOT NULL
);


--
-- Name: schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schedules_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schedules_id_seq OWNED BY public.schedules.id;


--
-- Name: sectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sectors (
    id text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shift_sessions; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: shift_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shift_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shift_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shift_sessions_id_seq OWNED BY public.shift_sessions.id;


--
-- Name: smart_alerts; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: smart_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.smart_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: smart_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.smart_alerts_id_seq OWNED BY public.smart_alerts.id;


--
-- Name: store_cash; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: store_cash_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.store_cash_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: store_cash_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.store_cash_id_seq OWNED BY public.store_cash.id;


--
-- Name: store_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_forecasts (
    store_id text NOT NULL,
    forecast_date date NOT NULL,
    metric text DEFAULT 'sim'::text NOT NULL,
    predicted numeric NOT NULL,
    model text DEFAULT 'dow_avg'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: store_hour_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_hour_profile (
    store_id text NOT NULL,
    dow integer NOT NULL,
    hour integer NOT NULL,
    weight numeric DEFAULT 1 NOT NULL,
    sample_count integer DEFAULT 0
);


--
-- Name: store_month_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_month_plans (
    id bigint NOT NULL,
    store_id text NOT NULL,
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
    credit_request numeric DEFAULT 0,
    credit_issued numeric DEFAULT 0,
    plotter numeric DEFAULT 0,
    hb numeric DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: store_month_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.store_month_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: store_month_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.store_month_plans_id_seq OWNED BY public.store_month_plans.id;


--
-- Name: store_plans; Type: TABLE; Schema: public; Owner: -
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
    esim numeric DEFAULT 0,
    tst numeric DEFAULT 0
);


--
-- Name: store_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.store_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: store_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.store_plans_id_seq OWNED BY public.store_plans.id;


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: supervisor_sectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_sectors (
    supervisor_id bigint NOT NULL,
    sector_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: supervisor_stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supervisor_stores (
    supervisor_id bigint NOT NULL,
    store_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support_attachments; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: support_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_attachments_id_seq OWNED BY public.support_attachments.id;


--
-- Name: support_faq; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_faq (
    id bigint NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true
);


--
-- Name: support_faq_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_faq_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_faq_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_faq_id_seq OWNED BY public.support_faq.id;


--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: support_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_messages_id_seq OWNED BY public.support_messages.id;


--
-- Name: support_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_templates (
    id bigint NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    category text,
    is_active boolean DEFAULT true
);


--
-- Name: support_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_templates_id_seq OWNED BY public.support_templates.id;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: support_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.support_tickets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: support_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.support_tickets_id_seq OWNED BY public.support_tickets.id;


--
-- Name: xp_events; Type: TABLE; Schema: public; Owner: -
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


--
-- Name: xp_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.xp_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: xp_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.xp_events_id_seq OWNED BY public.xp_events.id;


--
-- Name: access_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_requests ALTER COLUMN id SET DEFAULT nextval('public.access_requests_id_seq'::regclass);


--
-- Name: ai_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_audit ALTER COLUMN id SET DEFAULT nextval('public.ai_audit_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: bfq_manual id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bfq_manual ALTER COLUMN id SET DEFAULT nextval('public.bfq_manual_id_seq'::regclass);


--
-- Name: bfq_questionnaires id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bfq_questionnaires ALTER COLUMN id SET DEFAULT nextval('public.bfq_questionnaires_id_seq'::regclass);


--
-- Name: channel_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages ALTER COLUMN id SET DEFAULT nextval('public.channel_messages_id_seq'::regclass);


--
-- Name: combo_calculations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_calculations ALTER COLUMN id SET DEFAULT nextval('public.combo_calculations_id_seq'::regclass);


--
-- Name: employee_badges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_badges ALTER COLUMN id SET DEFAULT nextval('public.employee_badges_id_seq'::regclass);


--
-- Name: employee_month_plan_values id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plan_values ALTER COLUMN id SET DEFAULT nextval('public.employee_month_plan_values_id_seq'::regclass);


--
-- Name: employee_month_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plans ALTER COLUMN id SET DEFAULT nextval('public.employee_month_plans_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: offline_sync_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_log ALTER COLUMN id SET DEFAULT nextval('public.offline_sync_log_id_seq'::regclass);


--
-- Name: report_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images ALTER COLUMN id SET DEFAULT nextval('public.report_images_id_seq'::regclass);


--
-- Name: rtk_promocodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtk_promocodes ALTER COLUMN id SET DEFAULT nextval('public.rtk_promocodes_id_seq'::regclass);


--
-- Name: sale_metric_values id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_metric_values ALTER COLUMN id SET DEFAULT nextval('public.sale_metric_values_id_seq'::regclass);


--
-- Name: sales_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_audit ALTER COLUMN id SET DEFAULT nextval('public.sales_audit_id_seq'::regclass);


--
-- Name: sales_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_events ALTER COLUMN id SET DEFAULT nextval('public.sales_events_id_seq'::regclass);


--
-- Name: schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules ALTER COLUMN id SET DEFAULT nextval('public.schedules_id_seq'::regclass);


--
-- Name: shift_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_sessions ALTER COLUMN id SET DEFAULT nextval('public.shift_sessions_id_seq'::regclass);


--
-- Name: smart_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_alerts ALTER COLUMN id SET DEFAULT nextval('public.smart_alerts_id_seq'::regclass);


--
-- Name: store_cash id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_cash ALTER COLUMN id SET DEFAULT nextval('public.store_cash_id_seq'::regclass);


--
-- Name: store_month_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_month_plans ALTER COLUMN id SET DEFAULT nextval('public.store_month_plans_id_seq'::regclass);


--
-- Name: store_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_plans ALTER COLUMN id SET DEFAULT nextval('public.store_plans_id_seq'::regclass);


--
-- Name: support_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_attachments ALTER COLUMN id SET DEFAULT nextval('public.support_attachments_id_seq'::regclass);


--
-- Name: support_faq id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_faq ALTER COLUMN id SET DEFAULT nextval('public.support_faq_id_seq'::regclass);


--
-- Name: support_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages ALTER COLUMN id SET DEFAULT nextval('public.support_messages_id_seq'::regclass);


--
-- Name: support_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_templates ALTER COLUMN id SET DEFAULT nextval('public.support_templates_id_seq'::regclass);


--
-- Name: support_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets ALTER COLUMN id SET DEFAULT nextval('public.support_tickets_id_seq'::regclass);


--
-- Name: xp_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_events ALTER COLUMN id SET DEFAULT nextval('public.xp_events_id_seq'::regclass);


--
-- Name: access_requests access_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_requests
    ADD CONSTRAINT access_requests_pkey PRIMARY KEY (id);


--
-- Name: ai_audit ai_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_audit
    ADD CONSTRAINT ai_audit_pkey PRIMARY KEY (id);


--
-- Name: alert_flags alert_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alert_flags
    ADD CONSTRAINT alert_flags_pkey PRIMARY KEY (id);


--
-- Name: announcement_reads announcement_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY (announcement_id, employee_id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: bfq_manual bfq_manual_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bfq_manual
    ADD CONSTRAINT bfq_manual_pkey PRIMARY KEY (id);


--
-- Name: bfq_questionnaires bfq_questionnaires_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bfq_questionnaires
    ADD CONSTRAINT bfq_questionnaires_pkey PRIMARY KEY (id);


--
-- Name: channel_messages channel_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: combo_calculations combo_calculations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combo_calculations
    ADD CONSTRAINT combo_calculations_pkey PRIMARY KEY (id);


--
-- Name: employee_badges employee_badges_employee_id_badge_code_earned_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_badges
    ADD CONSTRAINT employee_badges_employee_id_badge_code_earned_at_key UNIQUE (employee_id, badge_code, earned_at);


--
-- Name: employee_badges employee_badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_badges
    ADD CONSTRAINT employee_badges_pkey PRIMARY KEY (id);


--
-- Name: employee_month_plan_values employee_month_plan_values_employee_id_month_metric_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plan_values
    ADD CONSTRAINT employee_month_plan_values_employee_id_month_metric_id_key UNIQUE (employee_id, month, metric_id);


--
-- Name: employee_month_plan_values employee_month_plan_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plan_values
    ADD CONSTRAINT employee_month_plan_values_pkey PRIMARY KEY (id);


--
-- Name: employee_month_plans employee_month_plans_employee_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plans
    ADD CONSTRAINT employee_month_plans_employee_id_month_key UNIQUE (employee_id, month);


--
-- Name: employee_month_plans employee_month_plans_employee_month_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plans
    ADD CONSTRAINT employee_month_plans_employee_month_uq UNIQUE (employee_id, month);


--
-- Name: employee_month_plans employee_month_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plans
    ADD CONSTRAINT employee_month_plans_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: offline_sync_log offline_sync_log_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_log
    ADD CONSTRAINT offline_sync_log_client_id_key UNIQUE (client_id);


--
-- Name: offline_sync_log offline_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offline_sync_log
    ADD CONSTRAINT offline_sync_log_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: plan_metrics plan_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_metrics
    ADD CONSTRAINT plan_metrics_pkey PRIMARY KEY (id);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (id);


--
-- Name: report_images report_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_images
    ADD CONSTRAINT report_images_pkey PRIMARY KEY (id);


--
-- Name: rtk_promocodes rtk_promocodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtk_promocodes
    ADD CONSTRAINT rtk_promocodes_pkey PRIMARY KEY (id);


--
-- Name: sale_metric_values sale_metric_values_employee_id_store_id_sale_date_metric_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_metric_values
    ADD CONSTRAINT sale_metric_values_employee_id_store_id_sale_date_metric_id_key UNIQUE (employee_id, store_id, sale_date, metric_id);


--
-- Name: sale_metric_values sale_metric_values_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_metric_values
    ADD CONSTRAINT sale_metric_values_pkey PRIMARY KEY (id);


--
-- Name: sales_audit sales_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_audit
    ADD CONSTRAINT sales_audit_pkey PRIMARY KEY (id);


--
-- Name: sales sales_employee_store_date_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_employee_store_date_uq UNIQUE (employee_id, store_id, sale_date);


--
-- Name: sales_events sales_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_events
    ADD CONSTRAINT sales_events_pkey PRIMARY KEY (id);


--
-- Name: sales sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales
    ADD CONSTRAINT sales_pkey PRIMARY KEY (id);


--
-- Name: schedules schedules_employee_date_uq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_employee_date_uq UNIQUE (employee_id, work_date);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);


--
-- Name: sectors sectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sectors
    ADD CONSTRAINT sectors_pkey PRIMARY KEY (id);


--
-- Name: shift_sessions shift_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_sessions
    ADD CONSTRAINT shift_sessions_pkey PRIMARY KEY (id);


--
-- Name: smart_alerts smart_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_alerts
    ADD CONSTRAINT smart_alerts_pkey PRIMARY KEY (id);


--
-- Name: store_cash store_cash_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_cash
    ADD CONSTRAINT store_cash_pkey PRIMARY KEY (id);


--
-- Name: store_cash store_cash_store_id_cash_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_cash
    ADD CONSTRAINT store_cash_store_id_cash_date_key UNIQUE (store_id, cash_date);


--
-- Name: store_forecasts store_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_forecasts
    ADD CONSTRAINT store_forecasts_pkey PRIMARY KEY (store_id, forecast_date, metric);


--
-- Name: store_hour_profile store_hour_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_hour_profile
    ADD CONSTRAINT store_hour_profile_pkey PRIMARY KEY (store_id, dow, hour);


--
-- Name: store_month_plans store_month_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_month_plans
    ADD CONSTRAINT store_month_plans_pkey PRIMARY KEY (id);


--
-- Name: store_month_plans store_month_plans_store_id_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_month_plans
    ADD CONSTRAINT store_month_plans_store_id_month_key UNIQUE (store_id, month);


--
-- Name: supervisor_sectors supervisor_sectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_sectors
    ADD CONSTRAINT supervisor_sectors_pkey PRIMARY KEY (supervisor_id, sector_id);


--
-- Name: supervisor_stores supervisor_stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_stores
    ADD CONSTRAINT supervisor_stores_pkey PRIMARY KEY (supervisor_id, store_id);


--
-- Name: support_attachments support_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_attachments
    ADD CONSTRAINT support_attachments_pkey PRIMARY KEY (id);


--
-- Name: support_faq support_faq_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_faq
    ADD CONSTRAINT support_faq_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_templates support_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_templates
    ADD CONSTRAINT support_templates_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: xp_events xp_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xp_events
    ADD CONSTRAINT xp_events_pkey PRIMARY KEY (id);


--
-- Name: idx_access_req_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_access_req_status ON public.access_requests USING btree (status, created_at DESC);


--
-- Name: idx_access_req_tg_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_access_req_tg_pending ON public.access_requests USING btree (telegram_id) WHERE (status = 'pending'::text);


--
-- Name: idx_ai_audit_dip_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_audit_dip_lookup ON public.ai_audit USING btree (store_id, ref_date, kind, created_at DESC);


--
-- Name: idx_ai_audit_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_audit_employee ON public.ai_audit USING btree (employee_id, kind, created_at DESC);


--
-- Name: idx_bfq_q_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bfq_q_employee ON public.bfq_questionnaires USING btree (employee_id, created_at);


--
-- Name: idx_emp_month_plans_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emp_month_plans_month ON public.employee_month_plans USING btree (month);


--
-- Name: idx_employees_telegram; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_telegram ON public.employees USING btree (telegram_id);


--
-- Name: idx_rtk_promos_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rtk_promos_active ON public.rtk_promocodes USING btree (is_used, created_at DESC) WHERE (is_used = false);


--
-- Name: idx_sales_audit_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_audit_date ON public.sales_audit USING btree (sale_date);


--
-- Name: idx_sales_audit_employee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_audit_employee ON public.sales_audit USING btree (employee_id, sale_date);


--
-- Name: idx_sales_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_date ON public.sales USING btree (sale_date);


--
-- Name: idx_sales_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_employee_date ON public.sales USING btree (employee_id, sale_date);


--
-- Name: idx_sales_events_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_hour ON public.sales_events USING btree (store_id, sale_hour);


--
-- Name: idx_sales_events_store_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_events_store_date ON public.sales_events USING btree (store_id, sale_date);


--
-- Name: idx_schedules_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_schedules_date ON public.schedules USING btree (work_date);


--
-- Name: idx_shift_sessions_emp_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_sessions_emp_date ON public.shift_sessions USING btree (employee_id, work_date);


--
-- Name: idx_shift_sessions_store_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shift_sessions_store_open ON public.shift_sessions USING btree (store_id, status) WHERE (status = 'open'::text);


--
-- Name: idx_smart_alerts_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_alerts_open ON public.smart_alerts USING btree (status, created_at DESC);


--
-- Name: idx_store_cash_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_cash_date ON public.store_cash USING btree (cash_date);


--
-- Name: idx_supervisor_stores_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supervisor_stores_store ON public.supervisor_stores USING btree (store_id);


--
-- Name: idx_support_messages_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_ticket ON public.support_messages USING btree (ticket_id);


--
-- Name: idx_support_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_open ON public.support_tickets USING btree (status, created_at DESC);


--
-- Name: idx_support_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_status ON public.support_tickets USING btree (status, created_at DESC);


--
-- Name: uq_bfq_manual_emp_month; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_bfq_manual_emp_month ON public.bfq_manual USING btree (employee_id, month);


--
-- Name: access_requests access_requests_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_requests
    ADD CONSTRAINT access_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: announcement_reads announcement_reads_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: channel_messages channel_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);


--
-- Name: employee_month_plan_values employee_month_plan_values_metric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_month_plan_values
    ADD CONSTRAINT employee_month_plan_values_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES public.plan_metrics(id);


--
-- Name: organizations organizations_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);


--
-- Name: regions regions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.regions
    ADD CONSTRAINT regions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: rtk_promocodes rtk_promocodes_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rtk_promocodes
    ADD CONSTRAINT rtk_promocodes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);


--
-- Name: sale_metric_values sale_metric_values_metric_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sale_metric_values
    ADD CONSTRAINT sale_metric_values_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES public.plan_metrics(id);


--
-- Name: supervisor_sectors supervisor_sectors_sector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_sectors
    ADD CONSTRAINT supervisor_sectors_sector_id_fkey FOREIGN KEY (sector_id) REFERENCES public.sectors(id);


--
-- Name: supervisor_sectors supervisor_sectors_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supervisor_sectors
    ADD CONSTRAINT supervisor_sectors_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.employees(id);


--
-- PostgreSQL database dump complete
--

