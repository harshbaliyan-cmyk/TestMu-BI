-- AM Performance: the AE board scoped to AM PODs.
--
-- The dashboards table is what dashboard_source_bindings joins against, so a
-- template that exists in code but has no row here cannot be bound to a source
-- and fails at commit with "Unknown dashboard".
INSERT INTO dashboards(template_key,name,description,is_system)
VALUES('am-performance','AM Performance','AM rep ranking by % of quota achieved, scoped to AM PODs',true)
ON CONFLICT(template_key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,updated_at=now();
