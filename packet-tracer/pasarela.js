// Pasarela RiegoGuard - Cisco Packet Tracer 9.0.1
var endpoint = "http://127.0.0.1:1880/riegoguard/red";
var farms = [
    { id: "tacna-norte", url: "http://10.40.10.10/telemetria", route: "esperando", virtualStatus: 0, postStatus: 0 },
    { id: "tacna-sur", url: "http://10.40.20.10/telemetria", route: "esperando", virtualStatus: 0, postStatus: 0 }
];

var diagClient = null;
var forwardClients = [null, null];
var virtualClients = [null, null];
var lastDiagnostic = 0;

function forward(index, farm, packet) {
    if (forwardClients[index]) return;
    try {
        var client = new RealHTTPClient();
        forwardClients[index] = client;
        client.onDone = function (status, body) {
            farm.postStatus = Number(status) || 0;
            Serial.println(">>> " + farm.id + " -> Node-RED HTTP " + status + " (sec " + packet.seq + ")");
            forwardClients[index] = null;
        };
        if (typeof client.post === "function") {
            client.post(endpoint, "data=" + encodeURIComponent(JSON.stringify(packet)));
        } else if (typeof client.postWithHeader === "function") {
            client.postWithHeader(endpoint, packet);
        }
    } catch (e) {
        forwardClients[index] = null;
    }
}

function pollFarm(index, farm, now) {
    if (virtualClients[index]) return;
    try {
        var client = new HTTPClient();
        virtualClients[index] = client;
        client.onDone = function (status, body) {
            virtualClients[index] = null;
            farm.virtualStatus = Number(status) || 0;
            if (farm.virtualStatus !== 200) {
                farm.route = "sin-respuesta";
                return;
            }

            var packet = null;
            if (typeof body === "object" && body !== null) {
                packet = body;
            } else {
                try { packet = JSON.parse(body); } catch (e) {}
            }

            if (packet && typeof packet === "object") {
                packet.farm = farm.id;
                farm.route = "alcanzable";
                forward(index, farm, packet);
            } else {
                farm.route = "respuesta-invalida";
            }
        };
        client.open(farm.url);
    } catch (e) {
        virtualClients[index] = null;
    }
}

function sendDiagnostic(now) {
    if (diagClient) return;
    if (now - lastDiagnostic < 3000) return;
    lastDiagnostic = now;
    try {
        diagClient = new RealHTTPClient();
        diagClient.onDone = function (status, body) { diagClient = null; };
        var payload = {
            norte: farms[0].route, sur: farms[1].route,
            virtualNorte: farms[0].virtualStatus || 0, virtualSur: farms[1].virtualStatus || 0,
            postNorte: farms[0].postStatus || 0, postSur: farms[1].postStatus || 0
        };
        if (typeof diagClient.post === "function") {
            diagClient.post(endpoint + "/diagnostico", "data=" + encodeURIComponent(JSON.stringify(payload)));
        } else if (typeof diagClient.postWithHeader === "function") {
            diagClient.postWithHeader(endpoint + "/diagnostico", payload);
        }
    } catch (e) { diagClient = null; }
}

function setup() {
    Serial.println("=== Pasarela RiegoGuard Lista ===");
    Serial.println("Destino Node-RED: " + endpoint);
}

function loop() {
    var now = new Date().getTime();
    for (var i = 0; i < farms.length; i++) pollFarm(i, farms[i], now);
    sendDiagnostic(now);
    delay(2000);
}
