INSERT INTO dashboards(template_key,name,description,is_system)
VALUES('ae-performance','AE Performance','AE rep ranking by share of closed ARR, with period comparison',true)
ON CONFLICT(template_key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,updated_at=now();
