INSERT INTO dashboards(template_key,name,description,is_system)
VALUES('loss-board','Loss Board','Where business is being lost — ARR lost rate, loss reasons, and lost-after-trial',true)
ON CONFLICT(template_key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,updated_at=now();
