-- Verificación de 0 doble-venta tras la prueba de carga (evento estadio-load-test).
-- sold_seats  = asientos marcados vendidos
-- active_items = líneas de orden activas (deben coincidir con sold_seats)
-- double_sold  = asientos con >1 línea activa → DEBE ser 0
-- capacity     = aforo; sold_seats DEBE ser <= capacity
WITH ev AS (SELECT id FROM events WHERE slug = 'estadio-load-test')
SELECT
  (SELECT capacity FROM localities l JOIN ev ON ev.id = l.event_id LIMIT 1) AS capacity,
  (SELECT count(*) FROM seats se
     JOIN localities l ON l.id = se.locality_id
     JOIN ev ON ev.id = l.event_id
   WHERE se.status = 'sold') AS sold_seats,
  (SELECT count(*) FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN ev ON ev.id = o.event_id
   WHERE oi.active AND oi.seat_id IS NOT NULL) AS active_items,
  (SELECT count(*) FROM (
     SELECT oi.seat_id FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN ev ON ev.id = o.event_id
     WHERE oi.active AND oi.seat_id IS NOT NULL
     GROUP BY oi.seat_id HAVING count(*) > 1
   ) d) AS double_sold;
