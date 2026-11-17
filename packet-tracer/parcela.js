// El generador inserta la identidad de la parcela al comienzo de este programa.
var sequence = 0;
var session = "pt-" + profile.farm + "-" + new Date().getTime();

function setup() {
    HTTPServer.route("/telemetria", function (url, response) {
        sequence += 1;
        var phase = (sequence % 12) / 12;
        var valve = phase < 0.42 ? profile.valve : 0;
        var soil = [];
        for (var i = 0; i < 4; i++) {
            soil.push(Math.round((profile.soil[i] + Math.sin(sequence / 4 + i) * 1.3) * 10) / 10);
        }
        var packet = {
            v: 2, farm: profile.farm, boot: session, seq: sequence,
            sampledAt: new Date().getTime(), valve: valve,
            flow: valve ? profile.flow : 0, pressure: valve ? profile.pressure : 0,
            soil: soil, air: { temperature: profile.temperature, humidity: profile.humidity }
        };
        response.setContentType("application/json");
        response.send(JSON.stringify(packet));
    });
    var started = HTTPServer.start(80);
    Serial.println(profile.farm + (started === false ? " no pudo abrir el puerto HTTP virtual 80" : " disponible en /telemetria"));
    if (typeof Network !== "undefined") Serial.println("IP virtual " + Network.localIP() + " · puerta " + Network.gatewayIP());
}

function loop() {
    delay(1000);
}
