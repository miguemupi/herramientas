# Plantilla de herramienta

1. `cp -r _plantilla nueva` y cambia el contenido de `public/index.html` y las rutas `/api/*` de `server.js`.
2. Rutas del cliente **relativas** (`fetch('api/x')`, `href="style.css"`), nunca `/api/x`.
3. Colores solo con tokens `--t-*` (ver `theme.css`) para que siga el tema del hub.
4. Registrar en `hub/tools.json`: `{ "id": "nueva", "label": "…", "icon": "◈", "upstream": "http://proyecto_nueva:4100" }`.
5. En Easypanel: servicio nuevo, Build path `/nueva`, sin dominio, con `HUB_SECRET` igual al del hub.
