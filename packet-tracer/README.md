# RiegoGuard en Packet Tracer

1. Inicia RiegoGuard con **Iniciar-Node-RED.cmd** y abre **Central de parcelas**. Los programas del archivo tienen configurado el puerto local **1880**.
2. Usa una sola ventana de Cisco Packet Tracer 9.0.1. Si Cisco ya está abierto, vuelve a cargar **RiegoGuard-Red.pkt** con **Archivo → Abrir** desde la carpeta del proyecto. Si pide iniciar sesión, completa ese paso en Cisco.
3. Deja el simulador en **Realtime**. En cada SBC, entra a **Programming**. Los tres proyectos se guardaron con la marca de ejecución. Si alguno figura detenido, selecciona su proyecto JavaScript y pulsa **Run**. Empieza por las dos parcelas y termina por la pasarela.
4. El SBC **PASARELA-NODERED** usa el cliente HTTP externo de Packet Tracer. Si el simulador bloquea esa función, en **Options → Preferences → Miscellaneous** habilita **Enable External Network Access from Device Scripts** y autoriza la conexión local que te muestre. En la consola de programación de la pasarela deben aparecer respuestas **HTTP 200** para ambos sitios. La sección **Enlace de Packet Tracer** de la central muestra el estado HTTP virtual y el código de Node-RED por parcela. [API JavaScript de Cisco](https://tutorials.ptnetacad.net/help/default/iot_javascript_api.htm)
5. Comprueba que **Tacna Norte** y **Tacna Sur** cambien a **Vigente** en la central y que aumente el contador de paquetes. Cada SBC emite datos agrícolas de ensayo de su propia parcela.

## Si una parcela sigue sin datos

- **Sin señal de la pasarela** significa que Node-RED todavía no recibió su diagnóstico. Comprueba **Realtime**, **Programming → Run** en la pasarela y el acceso HTTP local de Packet Tracer.
- **Pasarela conectada · sin respuesta de estación** confirma el enlace local con Node-RED. Revisa que el programa de la estación indique que escucha en `/telemetria` y que el enlace de su router esté activo. En R-TACNA, `show ip interface brief` debe indicar **up/up** en las tres interfaces.
- **HTTP virtual 200 · Node-RED HTTP 200** confirma la ruta completa. La tarjeta de esa parcela debe quedar **Vigente** y aumentar su contador. **HTTP 409** indica una trama vencida, repetida o fuera de orden. La consola de programación muestra la respuesta.

## Prueba de conectividad

La pasarela consulta a Norte en `10.40.10.10` y a Sur en `10.40.20.10`. La pasarela tiene `10.40.30.10`. El router **R-TACNA** conecta las tres LAN /24.

1. Mantén Cisco en **Realtime** y ejecuta los tres programas. En el área de trabajo de Cisco puedes usar **Add Simple PDU** desde **PASARELA-NODERED** a cada parcela para comprobar el camino IP. La consola de la pasarela confirma también la capa HTTP con mensajes como `tacna-norte → Node-RED HTTP 200 · secuencia 12`. [Prueba de ping en Cisco Packet Tracer](https://tutorials.ptnetacad.net/help/default/mode_simulation.htm)
2. Abre [Central de parcelas](http://127.0.0.1:1880/riegoguard/panel?view=central). En una PowerShell abierta dentro de la carpeta `packet-tracer`, ejecuta `./Probar-Conectividad.ps1`. La prueba de solo lectura exige señal reciente de la pasarela, estado **Vigente**, código **HTTP 200** de Node-RED y al menos dos paquetes nuevos de cada parcela durante el intervalo. También puedes revisar [el estado JSON](http://127.0.0.1:1880/riegoguard/central).
3. Con la prueba normal aprobada, abre **R-TACNA → CLI**. Ejecuta `enable`, `configure terminal`, `interface GigabitEthernet0/0` y `shutdown`. Espera a que Norte figure **Vencida**, unos **8,5 s** desde su última muestra, y ejecuta `./Probar-Conectividad.ps1 -Escenario CorteNorte`. El contador de Norte debe quedarse fijo mientras el de Sur crece. La última lectura de Norte sigue visible como histórica.
4. Ejecuta `no shutdown` en la misma interfaz y vuelve a ejecutar la prueba normal cuando Norte recupere datos vigentes. Para probar Sur, usa **GigabitEthernet0/1** y `-Escenario CorteSur`.
5. Como evidencia visual, captura la prueba normal, el corte y la recuperación. En **Simulation** puedes filtrar **ARP**, **TCP** y **HTTP** para seguir las consultas dentro de Cisco. Vuelve a **Realtime** para medir la vigencia en la central.

Los programas de las parcelas y de la pasarela están dentro del `.pkt`. La carpeta también conserva `parcela.js`, `pasarela.js` y `generar_pkt.py` para edición. Si cambias el puerto de Node-RED, actualiza `endpoint` en el programa de **PASARELA-NODERED** y vuelve a ejecutarlo. El cliente HTTP externo solo reenvía una muestra si la consulta por la red simulada tuvo éxito.

Para reconstruir el archivo en otra PC, instala `packet-tracer-pkt-format==0.4.1` en un entorno Python y ejecuta `python generar_pkt.py --packet-tracer "D:/Cisco Packet Tracer 9.0.1"` con la ruta de tu instalación. [Herramienta de generación](https://github.com/aacanadaa/packet-tracer-pkt-format)
