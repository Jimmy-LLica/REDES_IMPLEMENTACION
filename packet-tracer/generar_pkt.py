"""Genera el .pkt con scripts embebidos para Packet Tracer 9.0.1."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
from xml.etree import ElementTree as ET

from pkt_core import Lab, decode


HERE = Path(__file__).resolve().parent
MASK = "255.255.255.0"


def pointer(element, name, value):
    target = element.find(name)
    if target is None:
        target = ET.SubElement(element, name)
    target.text = str(value)
    return target


def load_device(path, model):
    document = ET.fromstring(decode(path).xml)
    return next(item for item in document.findall("./NETWORK/DEVICES/DEVICE")
                if item.find("ENGINE/TYPE").get("model") == model)


def set_program(device, name, javascript, filesystem_template):
    engine = device.find("ENGINE")
    filesystem = deepcopy(filesystem_template)
    directory = filesystem.find(".//FILE[@class='CFileSystem']/FILES/FILE[@class='CDirectory']")
    pointer(directory, "NAME", name)
    pointer(directory.find(".//FILE_CONTENT[@class='CTextFileContent']"), "TEXT", javascript.rstrip() + "\n")
    original = engine.find("FILE_MANAGER")
    position = list(engine).index(original)
    engine.remove(original)
    engine.insert(position, filesystem)
    applications = pointer(engine, "USER_APPS", "")
    applications.clear()
    pointer(ET.SubElement(applications, "RUNNING_APPS"), "USER_APP", name)
    ET.SubElement(applications, "DESKTOP_APPS")


def save_ios(engine, lines):
    for tag in ("RUNNINGCONFIG", "STARTUPCONFIG"):
        config = engine.find(tag)
        if config is None:
            config = ET.SubElement(engine, tag)
        config.clear()
        for line in lines:
            ET.SubElement(config, "LINE").text = line


def add_switch(lab, name, x, y):
    switch = lab.add_device("2960-24TT", name, x, y)
    save_ios(lab.devs.findall("DEVICE")[-1].find("ENGINE"), [
        "!", "version 15.0", f"hostname {name}", "spanning-tree mode pvst", "!",
        "interface FastEthernet0/1", " switchport mode access", " spanning-tree portfast", "!",
        "interface GigabitEthernet0/1", " switchport mode access", " spanning-tree portfast", "!", "end",
    ])
    return switch


def build(install, output):
    sample_root = install / "saves" / "04 IoT"
    wired = load_device(sample_root / "Solution Examples" / "iot_http.pkt", "SBC-PT")
    example = load_device(sample_root / "Real HTTP" / "real-http-server-js.pkt", "SBC-PT")
    fs = example.find("ENGINE/FILE_MANAGER")
    user_files = fs.findall(".//FILE[@class='CFileSystem']")[1]
    user_files.find("FILES").clear()
    pointer(user_files, "FILE_COUNTER", 0)

    lab = Lab()
    lab.prune_seed_devices()
    lab.models["SBC-PT"] = ET.tostring(wired, encoding="utf-8")
    profiles = [
        ("NORTE", 10, 210, {"farm": "tacna-norte", "soil": [32, 39, 36, 43],
                            "temperature": 25, "humidity": 48, "flow": 11, "pressure": 1.6, "valve": 1}),
        ("SUR", 20, 510, {"farm": "tacna-sur", "soil": [42, 47, 38, 41],
                          "temperature": 21, "humidity": 63, "flow": 9, "pressure": 1.4, "valve": 3}),
    ]
    config = ["!", "version 15.1", "hostname R-TACNA", "!", "ip routing", "ip cef", "!"]
    for index, subnet in enumerate([10, 20, 30]):
        config.extend([f"interface GigabitEthernet0/{index}",
                       f" ip address 10.40.{subnet}.1 {MASK}", " duplex auto", " speed auto", " no shutdown", "!"])
    router = lab.add_device("2911", "R-TACNA", 630, 360, ios_config=config + ["end"])
    router_engine = lab.devs.find("./DEVICE/ENGINE")
    save_ios(router_engine, config + ["end"])
    ethernet = [port for port in router_engine.findall(".//PORT")
                if port.findtext("TYPE") == "eCopperGigabitEthernet"]
    for index, port in enumerate(ethernet[:3]):
        pointer(port, "POWER", "true")
        pointer(port, "IP", f"10.40.{[10, 20, 30][index]}.1")
        pointer(port, "SUBNET", MASK)

    for index, (name, subnet, y, profile) in enumerate(profiles):
        switch = add_switch(lab, "SW-" + name, 405, y)
        end = lab.add_device("SBC-PT", "PARCELA-" + name, 175, y, pc_ip=[f"10.40.{subnet}.10", MASK, f"10.40.{subnet}.1"])
        source = "var profile = " + json.dumps(profile) + ";\n" + (HERE / "parcela.js").read_text(encoding="utf-8")
        set_program(lab.devs.findall("DEVICE")[-1], "RiegoGuard " + name + " (JavaScript)", source, fs)
        lab.link(end, "FastEthernet0", switch, "FastEthernet0/1")
        lab.link(switch, "GigabitEthernet0/1", router, f"GigabitEthernet0/{index}")

    switch = add_switch(lab, "SW-CENTRAL", 840, 360)
    gateway = lab.add_device("SBC-PT", "PASARELA-NODERED", 1080, 360, pc_ip=["10.40.30.10", MASK, "10.40.30.1"])
    set_program(lab.devs.findall("DEVICE")[-1], "RiegoGuard Pasarela (JavaScript)",
                (HERE / "pasarela.js").read_text(encoding="utf-8"), fs)
    lab.link(router, "GigabitEthernet0/2", switch, "GigabitEthernet0/1")
    lab.link(switch, "FastEthernet0/1", gateway, "FastEthernet0")
    device_handles = {item.findtext("ENGINE/SAVE_REF_ID"): 10000 + i * 100
                      for i, item in enumerate(lab.devs.findall("DEVICE"))}
    for i, cable in enumerate(lab.net.findall("LINKS/LINK/CABLE")):
        for j, endpoint in enumerate(("FROM", "TO")):
            pointer(cable, endpoint + "_DEVICE_MEM_ADDR", device_handles[cable.findtext(endpoint)])
            pointer(cable, endpoint + "_PORT_MEM_ADDR", 20000 + i * 20 + j)
    pointer(lab.base, "DESCRIPTION", "RiegoGuard Tacna. Las dos parcelas se consultan por HTTP simulado. "
            "La pasarela reenvía a Node-RED por HTTP externo en 127.0.0.1:1880. "
            "Deshabilita GigabitEthernet0/0 para cortar Norte o GigabitEthernet0/1 para cortar Sur.")
    lab.save(output)
    print(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet-tracer", type=Path, required=True, help="Directorio de instalación de Packet Tracer")
    parser.add_argument("--output", type=Path, default=HERE / "RiegoGuard-Red.pkt")
    args = parser.parse_args()
    build(args.packet_tracer, args.output)
