# RiegoGuard Tacna

Simulación local de una parcela de 400 m², dividida en cuatro sectores de 100 m². El panel 2D y la parcela 3D comparten las lecturas y el estado de las válvulas. **Tacna Centro** usa Wokwi al arrancar Node-RED. La central recibe a **Tacna Norte** y **Tacna Sur** desde la pasarela de la topología editable cuando ambas rutas virtuales responden. Las tres alimentan **Central de parcelas** en Node-RED.

## Abrir la simulación

**Para exponer la demo**, extrae toda la carpeta y abre **`index.html`** en Chrome o Edge. Funciona sin internet con el simulador interno. Selecciona **Parcela 3D**, pulsa **Iniciar riego** y gira el modelo arrastrándolo. La rueda y los botones cambian el zoom. La vista muestra el agua en la tubería y los chorros de los tres aspersores del sector activo.

**Para usar el flujo editable**, instala Node.js 22 o 24 y ejecuta **`Iniciar-Node-RED.cmd`**. La primera ejecución descarga Node-RED y FlowFuse desde npm. El iniciador comprueba el reloj del flujo y abre la parcela 3D. Mantén abierta la consola. Si tenías abierta una versión anterior, cierra primero esa consola y usa el iniciador de esta carpeta. También puedes ejecutar `npm ci` y luego `npm start` en una terminal abierta en esta carpeta.

| Vista | Dirección local |
| --- | --- |
| Editor Node-RED | [127.0.0.1:1880](http://127.0.0.1:1880/) |
| Panel 2D y 3D servido por Node-RED | [127.0.0.1:1880/riegoguard/panel?view=parcel3d](http://127.0.0.1:1880/riegoguard/panel?view=parcel3d) |
| Panel dentro de FlowFuse | [127.0.0.1:1880/riego/panel](http://127.0.0.1:1880/riego/panel) |
| Cuatro grupos con `ui-gauge` y `ui-text` | [127.0.0.1:1880/riego/medidores](http://127.0.0.1:1880/riego/medidores) |
| Diagnóstico en vivo | [127.0.0.1:1880/riegoguard/estado](http://127.0.0.1:1880/riegoguard/estado) |
| Central de parcelas | [127.0.0.1:1880/riegoguard/panel?view=central](http://127.0.0.1:1880/riegoguard/panel?view=central) |
| Consulta de la central en JSON | [127.0.0.1:1880/riegoguard/central](http://127.0.0.1:1880/riegoguard/central) |

**Cómo comprobar que hay flujo en ejecución.** Comprueba que el panel indique **Node-RED activo**. En **Enlace ESP32**, los **Pulsos de reloj** aumentan cada segundo y el contador **Órdenes recibidas** cambia al usar los controles. El panel envía cada acción a `POST /riegoguard/orden` y recibe el estado actualizado como confirmación. También puedes pulsar **Iniciar riego** en el editor y ver el sector abierto en la barra lateral **Depuración**. [Captura del editor en ejecución](evidencias/06-flujo-node-red.png)

Si prefieres importar el proyecto en una instalación existente, instala `@flowfuse/node-red-dashboard` desde Manage palette, importa **`flows.json`** con el menú **Import** y pulsa **Deploy**. Si ya importaste la versión anterior, retira ese flujo antes de desplegar esta versión para evitar que ambos registren la misma ruta. Si el iniciador avisa que el puerto 1880 está ocupado, cierra la instancia anterior o define otro `PORT` (por ejemplo, `set PORT=1881` en CMD antes de iniciar). El puerto del firmware debe coincidir.

## Conectar el ESP32 de Wokwi

1. Ejecuta **`Iniciar-Node-RED.cmd`** en la PC y deja abierto el panel.
2. En VS Code, instala **Wokwi for VS Code** y activa la licencia de la extensión. Abre **la carpeta `wokwi`** como espacio de trabajo. Ya contiene `diagram.json`, `wokwi.toml`, el código de PlatformIO y el firmware compilado para el puerto 1880. [Configuración de Wokwi para VS Code](https://docs.wokwi.com/vscode/getting-started)
3. Pulsa **F1 → Wokwi: Start Simulator** y mantén visible la pestaña del simulador. Wokwi queda seleccionado por defecto. Cuando el LED verde de enlace se encienda, verifica **ESP32 conectado** y el contador de paquetes en **Enlace ESP32**. El riego queda bloqueado mientras falta telemetría vigente. Si el contador sigue en cero, verifica el puerto 1880 y revisa el monitor serie de Wokwi. Mientras tanto, **Simulador interno** permite probar todos los controles hidráulicos y la escena 3D.
4. En **Simulación** o **Parcela 3D**, pulsa **Iniciar riego**. Baja la perilla de cualquiera de los sectores a **35 % o menos**. Déjala quieta y pulsa **Iniciar riego**. En modo automático la humedad del suelo modelado aumenta con el caudal y la válvula confirmada. Al alcanzar **45 %**, la válvula cierra y la humedad baja gradualmente por secado. El funcionamiento es igual en S1, S2, S3 y S4. Los cuatro potenciómetros de la columna izquierda inferior están en ese orden, de arriba hacia abajo.
5. Baja el potenciómetro hidráulico de arriba (**caudal**) a menos de 7 L/min o el siguiente (**presión**) a menos de 1,2 bar. Tras dos muestras distintas fuera de rango, la consigna pasa a cero. El rearme requiere que ambas lecturas se recuperen y que esté seleccionada la condición **Normal**. Detener Wokwi interrumpe la telemetría y cierra la válvula del controlador.
6. Pulsa el DHT22 en Wokwi y mueve los controles de temperatura y humedad relativa del aire. Los cambios se ven en **Enlace ESP32** y **Central de parcelas**. Las lecturas ambientales se registran como contexto. Los umbrales de apertura y cierre usan la humedad del suelo.

El ESP32 envía aproximadamente cada 700 ms una solicitud `POST` a `http://host.wokwi.internal:1880/riegoguard/esp32`. El protocolo v2 incluye parcela, sesión de arranque, secuencia, hora de muestra, cuatro humedades de suelo, temperatura, humedad ambiental, caudal, presión y válvula observada. Node-RED responde `RG2 <válvula> <trama> <hora-ms>`. El ESP32 usa esa hora y su reloj de ejecución para fechar las muestras. Node-RED descarta duplicados, muestras fuera de orden y muestras vencidas a partir de la hora de adquisición. Un canal de suelo reportado sin lectura queda excluido del riego. Un cambio acumulado de al menos **0,5 puntos porcentuales** en una perilla fija un nuevo valor para ese sector. **Enlace ESP32** muestra tanto la posición de las perillas como la humedad que usa el modelo. El secado de Wokwi se aplica mientras hay telemetría fresca, también con el riego detenido. El control automático corta al cabo de 240 minutos virtuales si no se alcanza el objetivo.

**Si usas Wokwi en el navegador**, crea un proyecto ESP32, sustituye `diagram.json`, copia `wokwi/src/main.cpp` en el archivo `.ino` y agrega **DHT sensor library for ESPx** desde el administrador de bibliotecas. Para conectar con Node-RED en tu PC, ejecuta **Private IoT Gateway** y actívalo desde **F1 → Enable Private Wokwi IoT Gateway**. La pasarela privada del navegador requiere un plan de pago. Wokwi para VS Code trae su pasarela local integrada. [DHT22 en Wokwi](https://docs.wokwi.com/parts/wokwi-dht22) · [Pasarela y red de Wokwi](https://docs.wokwi.com/guides/esp32-wifi)

Si cambias el puerto o los pines, edita `wokwi/src/main.cpp` y compila con **PlatformIO → Build** o `pio run`. Copia `.pio/build/esp32dev/firmware.bin` a `firmware/riegoguard-esp32.bin` y reinicia Wokwi. Los GPIO 32, 33, 36 y 39 son suelo S1–S4. Los GPIO 34 y 35 leen caudal y presión, el 21 lee el DHT22, los GPIO 16–19 representan las válvulas y el 23 indica el enlace. El puente GPIO 22–GND identifica el circuito ampliado. Si queda cargado el diagrama anterior, el firmware reporta suelo y ambiente sin lectura para evitar usar entradas flotantes.

Para comprobar la integración HTTP sin abrir Wokwi, ejecuta `npm run esp32:prueba` en una segunda terminal y conserva **ESP32 externo (Wokwi)** como fuente. El cliente envía lecturas de ensayo y confirma la última consigna recibida. Acepta parámetros, por ejemplo `npm run esp32:prueba -- 12 1.8 34 sin-dato 42 41` simula cuatro sectores, con S2 sin lectura. Usa un cliente de Tacna Centro a la vez. [Captura del enlace con el cliente de prueba](evidencias/05-enlace-esp32.png)

## Conectar el archivo .pkt y comparar parcelas

Abre [RiegoGuard-Red.pkt](packet-tracer/RiegoGuard-Red.pkt) en Packet Tracer 9.0.1 con RiegoGuard v5 activo en el puerto 1880. El .pkt lleva embebidos los programas de **PARCELA-NORTE**, **PARCELA-SUR** y **PASARELA-NODERED**. La pasarela consulta ambas parcelas por HTTP dentro de la red simulada y reenvía las respuestas a Node-RED mediante `POST http://127.0.0.1:1880/riegoguard/red`. Para activar los programas y simular la caída de solo una red, sigue la [guía de Packet Tracer](packet-tracer/README.md).

**Central de parcelas** muestra última lectura y su vigencia, S1–S4, temperatura y humedad relativa del aire, caudal, presión, proporción de muestras válidas en banda y litros estimados acumulados. Puedes exportar el resumen a CSV. El volumen se integra entre muestras consecutivas que reportan la misma válvula abierta. Los agregados usan el almacén en disco del iniciador incluido. Si importas solo el flujo en otra instalación, usa el almacén `historico` de `settings.js` para persistir los agregados. La central supervisa Norte y Sur, y la parcela 2D/3D controla Tacna Centro. [Captura con datos de prueba](evidencias/09-central-parcelas.png)

## Guion para la exposición

1. **Turno normal.** Pulsa **Reiniciar simulación** e **Iniciar riego**. S1 empieza al 34 %, se abre y la conducción marca 12 L/min y 1,8 bar. Al alcanzar el 45 %, el registro muestra el cierre.
2. **Caudal bajo.** Reinicia e inicia de nuevo. Con S1 abierta, selecciona **Caudal bajo**. El caudal cae a 3 L/min y el sistema cierra la válvula tras dos lecturas consecutivas por debajo de 7 L/min. Cambia a **Normal** y pulsa **Rearmar e iniciar** para reanudar. **Presión baja** activa la misma protección al simular 0,7 bar frente a un mínimo de 1,2 bar.
3. **Corte y recuperación.** Reinicia, activa **Cortar conexión** e inicia el riego. Verás tres eventos pendientes: el corte, el inicio y la apertura. Desactiva el interruptor para recuperar la cola y ver los eventos confirmados. Si el turno terminó durante el corte, también se recupera el evento de cierre.

Para estas tres pruebas con valores de partida reproducibles, selecciona **Simulador interno** en Enlace ESP32 o abre `index.html`. En **Parcela 3D** también puedes probar **Caudal bajo** y **Presión baja** directamente. Con una válvula abierta verás el valor de prueba y, tras el cierre, la última lectura que causó la alarma. Con todas las válvulas cerradas, los valores de paso vuelven a cero y se muestra aparte la lectura disponible o la última muestra con riego.

Al terminar un turno, pulsa **Siguiente turno** para adelantar solo los minutos virtuales sin riego y abrir el siguiente sector habilitado. En automatizado se respeta el umbral del 35 %. En horario fijo se mantiene la siguiente hora programada. El avance manual de humedad en automático está disponible en la demo interna. El avance manual pertenece a la demo y la prueba E4 sigue ejecutando cada minuto.

Evidencias del panel en ejecución. [Riego normal](evidencias/01-riego-normal.png) · [Cierre por caudal bajo](evidencias/02-cierre-por-caudal-bajo.png) · [Recuperación de eventos](evidencias/03-recuperacion-de-eventos.png) · [Parcela 3D](evidencias/04-parcela-3d.png) · [Presión baja en 3D](evidencias/07-presion-baja-3d.png) · [Video de los aspersores](evidencias/08-aspersores.webm)

Un segundo real equivale a un minuto virtual durante el riego. En modo **Automatizado** se atiende primero el sector más seco entre los que llegan a 35 % o menos. En **Horario fijo** cada válvula recibe un turno diario de 12 minutos, a las 06:00, 06:12, 06:24 y 06:36 respectivamente. **Cortar conexión** interrumpe el envío al registro simulado y deja operativo el control. El registro y la cola viven en memoria y se borran al reiniciar la simulación.

## Prueba E4

Desde Node-RED, deja Wokwi enviando lecturas de los cuatro sectores. Abre **Comparativa E4** y pulsa **Capturar datos y ejecutar E4**. La corrida congela la humedad modelada S1–S4, el caudal y la presión disponibles en ese momento. El CSV identifica la fuente, la hora UTC y la secuencia Wokwi. Si falta un sector o vence la telemetría, la captura se deshabilita. Con una nueva captura se recalculan ambas estrategias.

E4 proyecta siete días virtuales por estrategia bajo los mismos valores capturados y los mismos parámetros de secado. Puede repetirse con otras entradas para contrastar escenarios. La comparación usa litros por m² al día y minutos-sector válidos dentro de la banda 35–45 %. El caudal disponible y la presión se mantienen como parámetros del escenario durante los siete días. Ejecutar `npm run e4` reproduce el ensayo nominal de referencia de `evidencias/` con los valores de arranque del modelo. La comparativa del panel usa los valores de la sesión al pulsar el botón.

## Archivos editables

- `app/simulador.js` contiene los parámetros y el modelo compartido entre la demo, el flujo y E4.
- `index.html`, `app/panel.css` y `app/panel.js` componen el panel. `app/parcela3d.js` dibuja la escena y controla la cámara.
- `flows.json` ya está listo para desplegar. `scripts/controlador-node-red.js` contiene la lógica del nodo que conecta los controles, la telemetría y las salidas. Después de editar estos archivos o el panel, `npm run build` vuelve a generar el flujo. Guarda aparte los cambios hechos manualmente en el editor antes de regenerarlo.
- `npm test` comprueba la histéresis, el horario fijo, las dos protecciones hidráulicas, el uso de lecturas externas, los eventos pendientes y E4.

[Documentación de Node-RED](https://nodered.org/docs/getting-started/local) · [FlowFuse Dashboard](https://dashboard.flowfuse.com/getting-started.html)
