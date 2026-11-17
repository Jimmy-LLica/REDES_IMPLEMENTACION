param(
    [ValidateSet('Normal', 'CorteNorte', 'CorteSur')]
    [string]$Escenario = 'Normal',
    [ValidateRange(10, 120)]
    [int]$Segundos = 16,
    [ValidateRange(1, 65535)]
    [int]$Puerto = 1880
)

$ErrorActionPreference = 'Stop'
$central = "http://127.0.0.1:$Puerto/riegoguard/central"
$ids = @('tacna-norte', 'tacna-sur')
$omitida = @{ Normal = ''; CorteNorte = 'tacna-norte'; CorteSur = 'tacna-sur' }[$Escenario]

function Leer-Central {
    $respuesta = Invoke-RestMethod -Uri $central -Method Get -TimeoutSec 4
    $parcelas = @{}
    foreach ($area in $respuesta.areas) {
        if ($area.id -in $ids -and $area.source -eq 'packet-tracer') {
            $parcelas[$area.id] = $area
        }
    }
    if ($parcelas.Count -ne $ids.Count -or $null -eq $respuesta.updatedAt) {
        throw 'La respuesta no contiene las dos parcelas de Packet Tracer de RiegoGuard.'
    }
    return @{ Parcelas = $parcelas; Diagnostico = $respuesta.packetTracer; Hora = $respuesta.updatedAt }
}

try {
    $inicio = Leer-Central
    Write-Host "Prueba $Escenario. Leyendo la central durante $Segundos segundos."
    Start-Sleep -Seconds $Segundos
    $fin = Leer-Central
} catch {
    Write-Host "SIN ACCESO A LA CENTRAL. $($_.Exception.Message)"
    Write-Host "Comprueba que Node-RED este activo en $central."
    exit 2
}

$diag = $fin.Diagnostico
$edad = if ($diag) { ($fin.Hora - $diag.at) / 1000 } else { $null }
$diagnosticoVigente = $null -ne $edad -and $edad -ge 0 -and $edad -lt 9
if ($diagnosticoVigente) {
    Write-Host "Pasarela vigente. Ultimo diagnostico hace $([math]::Round($edad, 1)) s."
    Write-Host "Norte $($diag.norte) | HTTP virtual $($diag.virtualNorte) | Node-RED HTTP $($diag.postNorte)"
    Write-Host "Sur   $($diag.sur) | HTTP virtual $($diag.virtualSur) | Node-RED HTTP $($diag.postSur)"
} else {
    Write-Host 'SIN SENAL VIGENTE DE LA PASARELA. Revisa su consola Programming en Packet Tracer.'
}

$filas = foreach ($id in $ids) {
    $antes = $inicio.Parcelas[$id]
    $ahora = $fin.Parcelas[$id]
    $nuevos = $ahora.packets - $antes.packets
    $estado = if ($ahora.online) { 'Vigente' } elseif ($ahora.last) { 'Vencida' } else { 'Sin datos' }
    $zona = if ($id -eq 'tacna-norte') { 'Norte' } else { 'Sur' }
    $ruta = if ($zona -eq 'Norte') { $diag.norte } else { $diag.sur }
    $post = if ($zona -eq 'Norte') { $diag.postNorte } else { $diag.postSur }
    $pasa = if ($id -eq $omitida) {
        $estado -eq 'Vencida' -and $nuevos -eq 0 -and $ruta -eq 'sin-respuesta'
    } else {
        $estado -eq 'Vigente' -and $nuevos -ge 2 -and $ruta -eq 'alcanzable' -and $post -eq 200
    }
    [pscustomobject]@{
        Parcela = "Tacna $zona"
        Inicio = $antes.packets
        Fin = $ahora.packets
        Nuevos = $nuevos
        Secuencia = $ahora.last.seq
        Estado = $estado
        Cumple = $pasa
    }
}
$filas | Format-Table -AutoSize

if ($diagnosticoVigente -and @($filas | Where-Object { -not $_.Cumple }).Count -eq 0) {
    Write-Host "PRUEBA APROBADA: $Escenario."
    exit 0
}
Write-Host "PRUEBA NO APROBADA: $Escenario. Revisa las rutas y el diagnostico de arriba."
exit 1
