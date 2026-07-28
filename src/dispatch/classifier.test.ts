import { describe, it, expect } from "vitest"; // swap for jest if that's the project's runner
import { classifyDispatch } from "./classifier.js";

const VALID_MESSAGES: string[] = [
  `Para la hora sale vehículo: CARGO 1721, TIPO: NODRIZA, placa: A56AH3L, conducido por el ciudadano: YORBIS GOMEZ, CI: 18.498.545, TLF:0424-7767350, con la cantidad de 32 motos el cual 28 motos van con destino al concesionario EMPRENDIMIENTO ANGEL CONTRERAS 27, EL VIGIA MERIDA, Y las otras 4 son modelos BOA 200CC de distintos colores con destino al concesionario, MOTO REPUESTOS  ZAMBRANO Y ALGO MAS, DE JUAN CARLOS ZAMBRANO, EL CHIVO ZULIA, Factura,(00014551), (00004561), NOTA DE  CONTROL  NUMERO (019125), (019135), LLEVA 32 FRANELAS.`,
  `Para la hora sale vehículo: CARGO 1721, TIPO: NODRIZA, placa: A61BW3S, conducido por el ciudadano: GABRIEL OROZCO, CI: 23.541.353, TLF:0416-5759951, con la cantidad de 38 motos el cual 33 motos van con destino al concesionario HOME CENTER BARJAS DE MEDIAN BARJAS HASSAN F.P, EL VIGIA MERIDA, Y las otras 5 son modelos BOA de distintas cilidradas y colores con destino al concesionario, MOTO REPUESTOS  ZAMBRANO Y ALGO MAS, DE JUAN CARLOS ZAMBRANO, EL CHIVO ZULIA, Factura,(00014545), (00004546), (00014560) NOTA DE  CONTROL  NUMERO (019119), (019120), (019134), LLEVA 38 FRANELAS.`,
  `Para la hora sale vehículo marca: KODIAK, NODRIZA, placa: A99BE0P, conducido por el ciudadano: NEICKER ANDRADE, cédula: v 28.152.277, teléfono: 0424-1703379, con la cantidad de 45 motos con dirección al concesionario: INVERSIONES NR OSORIO TACHIRA, según factura N° (14558-14559).`,
  `Para la hora sale vehículo marca: JAC, NODRIZA, placa: A74AB2R, conducido por el ciudadano: JOSE QUINTERO, cédula: v 12.206.548, teléfono: 0414-8103152, con la cantidad de 60 motos con dirección al concesionario: PEROZO LLANOS MOTOS IMPORT BARINAS, según factura N° (14547-14548) REPUESTOS POR GARANTÍA N° 3097-3098.`,
  `Para la hora sale vehículo marca: IVECO, NODRIZA, placa: A93AF8U, conducido por el ciudadano: YINMER ROJAS, cédula: v 22.111.554, teléfono: 0424-5445399, con la cantidad de 52 motos con dirección al concesionario: PEROZO LLANOS MOTOS IMPORT BARINAS, según factura N° (14554-14555).`,
  `Para la hora sale vehículo: ENCAVA ET-8, TIPO: NODRIZA, placa: A03EP9P, conducido por el ciudadano: JOEL MARTINEZ, CI: 20.369.757, TLF:0412-1741853, con la cantidad de 55 motos con destino al concesionario, RUBEN OSORIO (INVERSIONES NR MOTOS OSORIO F.P), TACHIRA, Factura,(00014556), (00014557) NOTA DE  CONTROL  NUMERO (019130), (019131) LLEVA 55 FRANELAS.`,
  `Para la hora sale vehículo: ENCAVA ET-8, TIPO: NODRIZA, placa: A94EE6P, conducido por el ciudadano: LUIS OCHOA, CI: 20.607.726, TLF:0412-1761714, con la cantidad de 55 motos con destino al concesionario, RUBEN OSORIO (INVERSIONES NR MOTOS OSORIO F.P), TACHIRA, Factura,(00014552), (00014553) NOTA DE  CONTROL  NUMERO (019126), (019127) UNA GARANTÍA NÚMERO (00003096) LLEVA 55 FRANELAS.`,
  `Para la hora sale vehículo:  DONG FENG, TIPO: NODRIZA, placa: A51D08K, conducido por el ciudadano: JESUS CARRILLO, CI: 24.328.013, TLF:0414-5569311, Reflejando en las facturas la cantidad de 40 motos con destino al concesionario VARIEDADES LAMER MENTHER DE RIHAN MENTHER,F.P ED MERIDA factura,(00014550), (00014549) NÚMERODE CONTROL (019123), (019124) LLEVA 40 FRANELAS..`,
  `Para la hora sale vehículo: MITSUBISHI, TIPO: NODRIZA, placa: A57BB1R, conducido por el ciudadano: WILMAN CARDONA, CI: 6.487.733, TLF:0412-5555799, con la cantidad de 35 motos con destino al concesionario, MEGA REPUESTOS SOUJAA MOUHANAD, F.P, SAN FELIPE YARACUY, Factura,(00014532), (000014533) NOTA DE  CONTROL  NUMERO (019107), (019106), Y UNA GARANTÍA  NÚMERO (00003095), LLEVA 35 FRANELAS.`,
  `Para la hora sale vehículo marca: JAC, NODRIZA, placa: A93AB7V, conducido por el ciudadano: LUIS QUINTERO, cédula: v 27.358.921, teléfono: 0412-1581862, con la cantidad de 22 motos con dirección al concesionario: PEROZO LLANOS MOTOS IMPORT BARINAS, según factura N° (14544).`,
  `Siendo las 11:19, pm Se retira de esta Planta de Ensamblaje de Motos AYAH HAOJIN. Vehiculo HYUNDAI Tipo Nodriza Placa A44CG9G Chófer Henry Corona  C.I: 30881596 Telf 0416-1683595
Con 32 Motos Según Fact. 14538,14539
16 Franelas
Garantía N-3089
de un Piñón de Kilometraje de Águila
Nota de Despacho de un Tanque de Combustible de Moto Modelo Aguila Color Turquesa
Destino EMPRENDIMIENTO MIGUEL SAMRA 2
MATURÍN EDO. MONAGAS`,
  `Siendo las 15:20 horas sale vehículo camión Dongfeng color blanco placas A02DR1M conducido por el cddno William Gutiérrez CI NRO 18138516, con la cantidad de 40 motos según factura NRO 4536(30 motos) y 4537(10 motos), e igualmente repuesto que se especifica en la garantía  NRO 00003090 destino cima Center Al Bonnay guasdualito Edo apure, celular del conductor 04249039051.`,
  `Siendo las 11:15 horas sale vehículo camión Jac placas A65AD8N conducido por el cddno Juan rondón CI NRO 18725430, con la cantidad de 33 motos según factura NRO 4540(30 motos), y 4543(03 motos), destino MD haojin Lara 2025 f.p Barquisimeto Edo Lara, celular del conductor 04129549414.`,
  `Para la hora sale vehículo marca: KODIAK, FURGÓN, placa: 121XJB, conducido por el ciudadano: ARMANDO QUERALES, cédula: v 16.528.292, teléfono: 0414-5872449, con la cantidad de 30 motos con dirección al concesionario: MOTORSREPUESTOS J.A TACHIRA, según factura N° (14541-14542).`,
];

const INVALID_MESSAGES: string[] = [
  `Para la hora ingresa vehículo marca DYNA, NODRIZA, N° 004, conducido por el ciudadano FRANCISCO ABANO`,
  `Siendo las 10:20 horas,Ingresa vehículo camión perteneciente a esta empresa, conducido por el  cddno José Hernández ,el  mismo se encontraba para Barquisimeto.`,
  `En estos momentos se presenta Falla de Energía Eléctrica y se Activa Planta Generadora`,
  `Se le ha entrega del siguiente material de publicidad al cddno Jesús carrizales,chofer de la gerente de ventas Cinthya, mencionado material fue autorizado por la cddna yubeidi Alvarez jefe de recursos humanos.`,
  `Se restablece la Energía Eléctrica y se apaga Planta Generadora Sin Novedad`,
  `Para la hora ingresa proveedor de agua potable con 18 botellones llenos`,
  `A esta hora se efectuó revista por la parte posterior de estás instalaciones específicamente en el área de los galpones encontrando todo sin novedad.`,
  `Para la hora sin novedad el servicio de vigilancia en la planta ensambladora`,
  `Para la hora ingresa proveedor de hielo con (03) panelas`,
  `Siendo las 10:38am ingresa vehículo: NPR, NODRIZA, placa: A90BT5D, conducido por el ciudadano: DEIVIS LAYA, CI: 22.576.251, TLF:0416-4453950, con la cantidad de 1 moto modelo: CANARIO 150CC, PLACA: AF1U35T, SERIAL DE CARROCERÍA: 8YS1BA7B2TC018433, SERIAL  DEL MOTOR: HJ162FMJ261030157, proveniente del concesionario MD HAOJIN CAICARA, F.P, CAICARA DEL ORINOCO ESTADO BOLIVAR, el cual tubo un percance cuando la estaban bajando del camión...`,
  `Siendo las 8:49 am sale proveedor de hielo sin novedad`,
  `Para la hora sale proveedor del agua potable con la cantidad de 27 botellones vacíos`,
  `Para la hora ingresa un pistón por garantía el ciudadano informo que al momento de salir la garantía N°3082 salió con un Magneto de boa y un CDI de lechuza pero en el concesionario le dio para regresar solo el pistón malo también manifestó que el ciudadano Carlos Martinez encargado de garantía y quién recibió el repuesto tiene conocimiento de los repuestos malos faltantes`,
  `Para la hora sale trabajador de la empresa ciudadano: ANGEL HERNANDEZ Autorizado por RRHH AYAH C.A`,
  `Para la hora ingresa proveedor del hielo con 2 panelas`,
  `Para la hora sale proveedor del hielo sin novedad`,
  `Para la hora ingresa vehiculo kodiak tipo: nodriza conducido neicker andrade cedula: 28.152.977 telefono: 0424-1703379 proveniente del concesionario motos andes con una garantia: Carter de lechuza, guaya  velocímetro, y. CDI LECHUZA`,
  `Para la hora sale trabajador de la empresa ciudadano: CARLOS SEIJAS Autorizado por RRHH AYAH C.A.`,
  `Para la hora ingresa el transporte del agua con 27 botellones llenos`,
  `Para la hora sale el transporte del agua con 20 botellones vacíos`,
  `En estos momentos se retira de esta Planta de Ensamblaje de Motos AYAH HAOJIN. Vehículo de la Empresa Con 4 Neumáticos nuevos`,
  `Para la hora enciende automáticamente la planta generadora ya que hubo desperfecto en la energía eléctrica`,
  `Para la hora sin novedad`,
  `Para la hora sin novedad acá en la ensambladora`,
  `Para la hora el servicio se encuentra sin novedad`,
  `Para la hora se restablece la energía eléctrica y se apaga la planta generadora sin novedad`,
  `Siendo las 12:01am enciende automáticamente la planta generadora ya que hubo desperfecto en la energía eléctrica`,
];

describe("classifyDispatch — real valid messages", () => {
  VALID_MESSAGES.forEach((msg, i) => {
    it(`classifies valid message #${i + 1} as a dispatch`, () => {
      const result = classifyDispatch(msg);
      expect(result.isDispatch).toBe(true);
    });
  });
});

describe("classifyDispatch — real invalid messages", () => {
  INVALID_MESSAGES.forEach((msg, i) => {
    it(`classifies invalid message #${i + 1} as NOT a dispatch`, () => {
      const result = classifyDispatch(msg);
      expect(result.isDispatch).toBe(false);
    });
  });
});

describe("classifyDispatch — edge cases / regression guards", () => {
  it("rejects empty or undefined input", () => {
    expect(classifyDispatch("").isDispatch).toBe(false);
    expect(classifyDispatch(undefined).isDispatch).toBe(false);
    expect(classifyDispatch("   ").isDispatch).toBe(false);
  });

  it("rejects an arrival message even if it has a plate and a phrase like 'sale' elsewhere in a quoted context", () => {
    // Guards against the "ingresa ... vehículo" false positive the old
    // keyword-only scorer was vulnerable to.
    const msg =
      "Siendo las 10:38am ingresa vehículo: NPR, placa: A90BT5D, con la cantidad de 1 moto proveniente del concesionario X.";
    expect(classifyDispatch(msg).isDispatch).toBe(false);
  });

  it("rejects a departing company vehicle with no cargo/plate signal (tires, not a client dispatch)", () => {
    const msg =
      "En estos momentos se retira de esta Planta de Ensamblaje de Motos AYAH HAOJIN. Vehículo de la Empresa Con 4 Neumáticos nuevos";
    expect(classifyDispatch(msg).isDispatch).toBe(false);
  });

  it("accepts a plausible future phrasing not in the training examples", () => {
    // "despachado" instead of "sale"/"se retira" — new departure verb variant.
    const msg =
      "Vehículo despachado, placa B12CD3E, conducido por MARIA PEREZ, cédula 20.111.222, con la cantidad de 25 motos con destino al concesionario MOTOS DEL SUR, según factura N° 5001.";
    expect(classifyDispatch(msg).isDispatch).toBe(true);
  });

  it("stays under the 100ms performance budget for a long message", () => {
    const longMsg = VALID_MESSAGES[0].repeat(20);
    const start = performance.now();
    classifyDispatch(longMsg);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
