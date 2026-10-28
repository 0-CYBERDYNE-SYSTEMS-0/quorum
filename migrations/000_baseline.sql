-- Quorum baseline schema (generated from shared/schema.ts via pg_dump).
-- Applied automatically by scripts/migrate.mjs on a fresh database.

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Homebrew)
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: open_question_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.open_question_status AS ENUM (
    'open',
    'answered'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: company_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.company_profiles (
    id integer NOT NULL,
    user_id integer NOT NULL,
    company_name text DEFAULT 'My Company'::text NOT NULL,
    industry text DEFAULT ''::text NOT NULL,
    stage text DEFAULT ''::text NOT NULL,
    headcount text DEFAULT ''::text NOT NULL,
    revenue_band text DEFAULT ''::text NOT NULL,
    business_model text DEFAULT ''::text NOT NULL,
    markets text[] DEFAULT '{}'::text[],
    constraints text DEFAULT ''::text NOT NULL,
    risk_appetite text DEFAULT 'balanced'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: company_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_profiles_id_seq OWNED BY public.company_profiles.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.conversations (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title text DEFAULT 'New board session'::text,
    charter text,
    orchestrator_state jsonb,
    turn_budget integer DEFAULT 25,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: experts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.experts (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    model text NOT NULL,
    system_prompt text NOT NULL,
    custom_instructions text,
    avatar_url text
);


--
-- Name: experts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.experts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: experts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.experts_id_seq OWNED BY public.experts.id;


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.files (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    filename text NOT NULL,
    file_url text NOT NULL,
    file_type text NOT NULL,
    uploaded_by text NOT NULL,
    deliverable_id text,
    generation_request_id text,
    version integer,
    supersedes_file_id integer,
    superseded_at timestamp without time zone,
    uploaded_at timestamp without time zone DEFAULT now()
);


--
-- Name: files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.files_id_seq OWNED BY public.files.id;


--
-- Name: insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.insights (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    title text NOT NULL,
    points text[],
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: insights_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insights_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insights_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insights_id_seq OWNED BY public.insights.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    expert_id integer,
    user_id integer,
    content text NOT NULL,
    role text NOT NULL,
    expert_name text,
    expert_role text,
    artifacts json DEFAULT '[]'::json,
    mentions jsonb,
    is_synthesis boolean,
    answers_question_id integer,
    stance jsonb,
    "timestamp" timestamp without time zone DEFAULT now()
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: open_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.open_questions (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    message_id integer NOT NULL,
    expert_role text NOT NULL,
    question text NOT NULL,
    assumption text,
    status public.open_question_status DEFAULT 'open'::public.open_question_status NOT NULL,
    answer_message_id integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: open_questions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.open_questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: open_questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.open_questions_id_seq OWNED BY public.open_questions.id;


--
-- Name: session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.session (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: usage_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.usage_monthly (
    user_id integer NOT NULL,
    period text NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    ai_spend_usd double precision DEFAULT 0 NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.users (
    id integer NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    email text NOT NULL,
    tier text DEFAULT 'free'::text,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text DEFAULT 'inactive'::text,
    open_router_key text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: company_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles ALTER COLUMN id SET DEFAULT nextval('public.company_profiles_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: experts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experts ALTER COLUMN id SET DEFAULT nextval('public.experts_id_seq'::regclass);


--
-- Name: files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files ALTER COLUMN id SET DEFAULT nextval('public.files_id_seq'::regclass);


--
-- Name: insights id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights ALTER COLUMN id SET DEFAULT nextval('public.insights_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: open_questions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_questions ALTER COLUMN id SET DEFAULT nextval('public.open_questions_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: company_profiles company_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles
    ADD CONSTRAINT company_profiles_pkey PRIMARY KEY (id);


--
-- Name: company_profiles company_profiles_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles
    ADD CONSTRAINT company_profiles_user_id_unique UNIQUE (user_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: experts experts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experts
    ADD CONSTRAINT experts_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: insights insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: open_questions open_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_questions
    ADD CONSTRAINT open_questions_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: usage_monthly usage_monthly_user_id_period_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_monthly
    ADD CONSTRAINT usage_monthly_user_id_period_pk PRIMARY KEY (user_id, period);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.session USING btree (expire);


--
-- Name: files_current_deliverable_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX files_current_deliverable_unique ON public.files USING btree (conversation_id, deliverable_id) WHERE ((deliverable_id IS NOT NULL) AND (superseded_at IS NULL));


--
-- Name: files_deliverable_version_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX files_deliverable_version_unique ON public.files USING btree (conversation_id, deliverable_id, version) WHERE ((deliverable_id IS NOT NULL) AND (version IS NOT NULL));


--
-- Name: files_generation_request_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX files_generation_request_unique ON public.files USING btree (conversation_id, generation_request_id) WHERE (generation_request_id IS NOT NULL);


--
-- Name: open_questions_message_question_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX open_questions_message_question_unique ON public.open_questions USING btree (message_id, question);


--
-- Name: company_profiles company_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profiles
    ADD CONSTRAINT company_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: conversations conversations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: experts experts_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experts
    ADD CONSTRAINT experts_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: files files_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: files files_supersedes_file_id_files_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_supersedes_file_id_files_id_fk FOREIGN KEY (supersedes_file_id) REFERENCES public.files(id);


--
-- Name: insights insights_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insights
    ADD CONSTRAINT insights_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: messages messages_answers_question_id_open_questions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_answers_question_id_open_questions_id_fk FOREIGN KEY (answers_question_id) REFERENCES public.open_questions(id);


--
-- Name: messages messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: messages messages_expert_id_experts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_expert_id_experts_id_fk FOREIGN KEY (expert_id) REFERENCES public.experts(id);


--
-- Name: messages messages_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: open_questions open_questions_answer_message_id_messages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_questions
    ADD CONSTRAINT open_questions_answer_message_id_messages_id_fk FOREIGN KEY (answer_message_id) REFERENCES public.messages(id);


--
-- Name: open_questions open_questions_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_questions
    ADD CONSTRAINT open_questions_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: open_questions open_questions_message_id_messages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_questions
    ADD CONSTRAINT open_questions_message_id_messages_id_fk FOREIGN KEY (message_id) REFERENCES public.messages(id);


--
-- Name: usage_monthly usage_monthly_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_monthly
    ADD CONSTRAINT usage_monthly_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

