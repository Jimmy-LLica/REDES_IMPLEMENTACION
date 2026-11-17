// La consulta a cada parcela siempre atraviesa la red virtual.
var endpoint = "http://127.0.0.1:1880/riegoguard/red";
var farms = [
    { id: "tacna-norte", url: "http://10.40.10.10/telemetria", route: "esperando" },
    { id: "tacna-sur", url: "http://10.40.20.10/telemetria", route: "esperando" }
];
var diagnostic = null;
var lastDiagnostic = 0;

function forward(farm, packet) {
    var client = new RealHTTPClient();
    farm.external = { client: client, started: new Date().getTime() };
    client.onDone = function (status, body) {
        if (!farm.external || farm.external.client !== client) return;
        farm.external = null;
        farm.postStatus = Number(status) || 0;
        Serial.println(farm.id + " → Node-RED HTTP " + status + " · secuencia " + packet.seq);
        if (farm.postStatus !== 200 && body) Serial.println(String(body).slice(0, 280));
    };
    client.postWithHeader(endpoint, packet, { "Content-Type": "application/json" });
}

function pollFarm(farm, now) {
    if (farm.external) {
        if (now - farm.external.started < 5000) return;
        farm.external = null;
        farm.postStatus = 0;
        Serial.println(farm.id + " sin respuesta HTTP externa. Comprueba Node-RED y el acceso externo.");
    }
    if (farm.virtual) {
        if (now - farm.virtual.started < 4200) return;
        var expired = farm.virtual.client;
        farm.virtual = null;
        expired.stop();
        farm.route = "sin-respuesta";
        farm.virtualStatus = 0;
        return;
    }
    var client = new HTTPClient();
    farm.virtual = { client: client, started: now };
    client.onDone = function (status, body) {
        if (!farm.virtual || farm.virtual.client !== client) return;
        farm.virtual = null;
        farm.virtualStatus = Number(status) || 0;
        if (farm.virtualStatus !== 200) {
            farm.route = "sin-respuesta";
            Serial.println(farm.id + " sin ruta HTTP simulada (" + status + ")");
            return;
        }
        var packet;
        try {
            packet = JSON.parse(String(body));
        } catch (error) {
            farm.route = "respuesta-invalida";
            return;
        }
        if (!packet || packet.farm !== farm.id) {
            farm.route = "respuesta-invalida";
            return;
        }
        farm.route = "alcanzable";
        forward(farm, packet);
    };
    client.open(farm.url);
}

function sendDiagnostic(now) {
    if (diagnostic) {
        if (now - diagnostic.started < 5500) return;
        diagnostic = null;
        Serial.println("Node-RED sin respuesta de diagnóstico. Comprueba el acceso externo de Packet Tracer.");
    }
    if (now - lastDiagnostic < 3000) return;
    lastDiagnostic = now;
    var client = new RealHTTPClient();
    diagnostic = { client: client, started: now };
    client.onDone = function (status) {
        if (!diagnostic || diagnostic.client !== client) return;
        diagnostic = null;
        if (Number(status) !== 200) Serial.println("Diagnóstico de Node-RED HTTP " + status);
    };
    client.postWithHeader(endpoint + "/diagnostico", { norte: farms[0].route, sur: farms[1].route,
        virtualNorte: farms[0].virtualStatus || 0, virtualSur: farms[1].virtualStatus || 0,
        postNorte: farms[0].postStatus || 0, postSur: farms[1].postStatus || 0 },
        { "Content-Type": "application/json" });
}

function setup() {
    Serial.println("Pasarela RiegoGuard hacia " + endpoint);
    if (typeof Network !== "undefined") Serial.println("IP virtual " + Network.localIP() + " · puerta " + Network.gatewayIP());
}

function loop() {
    var now = new Date().getTime();
    for (var i = 0; i < farms.length; i++) pollFarm(farms[i], now);
    sendDiagnostic(now);
    delay(1800);
}
