INSERT INTO dashboards(template_key,name,description,is_system)
VALUES('win-board','Win Board','Won ARR, ARR win rate, and contribution analysis',true)
ON CONFLICT(template_key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,updated_at=now();
