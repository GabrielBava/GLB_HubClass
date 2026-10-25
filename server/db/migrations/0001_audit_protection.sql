-- Trilha de auditoria somente-inserção.
-- UPDATE é sempre bloqueado. DELETE só é aceito pela rotina de retenção,
-- que liga a variável de sessão lifeclass.audit_purge = 'on' dentro da transação.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs é somente inserção';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('lifeclass.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'exclusão de audit_logs só é permitida pela rotina de retenção';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_logs_no_truncate() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('lifeclass.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'TRUNCATE de audit_logs não é permitido';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_truncate_guard BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_no_truncate();
