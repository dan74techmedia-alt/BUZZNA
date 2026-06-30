-- 0014_automation_notifications_audit.sql
-- Description: Immutable audit trail ledgers and notification/automation job tracking.

CREATE TABLE audit_logs (
    audit_log_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
    action character varying NOT NULL,
    entity_name character varying NOT NULL,
    entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    client_ip character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE security_events (
    security_event_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(user_id) ON DELETE SET NULL,
    event_type character varying NOT NULL,
    severity character varying NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE automation_rules (
    rule_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    name character varying NOT NULL,
    trigger_type character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE automation_conditions (
    condition_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    rule_id uuid NOT NULL REFERENCES automation_rules(rule_id) ON DELETE CASCADE,
    field character varying NOT NULL,
    operator character varying NOT NULL,
    value character varying NOT NULL
);

CREATE TABLE automation_actions (
    action_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    rule_id uuid NOT NULL REFERENCES automation_rules(rule_id) ON DELETE CASCADE,
    action_type character varying NOT NULL,
    configuration jsonb NOT NULL
);

CREATE TABLE automation_execution_runs (
    run_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    rule_id uuid NOT NULL REFERENCES automation_rules(rule_id) ON DELETE CASCADE,
    status character varying NOT NULL,
    logs text,
    executed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE notification_templates (
    template_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    name character varying NOT NULL,
    channel character varying NOT NULL,
    body_template text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE notification_jobs (
    job_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    template_id uuid NOT NULL REFERENCES notification_templates(template_id) ON DELETE CASCADE,
    scheduled_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying DEFAULT 'PENDING' NOT NULL
);

CREATE TABLE notification_delivery_logs (
    log_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES businesses(tenant_id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES notification_jobs(job_id) ON DELETE CASCADE,
    recipient character varying NOT NULL,
    status character varying NOT NULL,
    error_message text,
    sent_at timestamp with time zone
);

-- Enable Row-Level Security
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
-- Conditions and Actions cascade via Rule_ID, RLS on Rule covers them practically, but we enable anyway.
ALTER TABLE automation_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_execution_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_logs ENABLE ROW LEVEL SECURITY;