/**
 * Contenido de los DATOS DE DEMOSTRACIÓN (`prisma/demo-data.ts`): personas ficticias, lugares y textos.
 * Nombres inventados; correos en el dominio demo (nunca reciben correo). Ver docs/DEPLOY.md, sección 10.
 */
import type {
  ContactOrigin,
  ContactProjectType,
  ContactService,
  ContactStatus,
  ContactSubject,
} from '../../src/generated/prisma/client';

/** Lugar de residencia. México usa el catálogo INEGI (clave de estado y municipio). */
export type DemoPlace =
  | { country: 'MX'; state: string; municipality: string; timezone: string; area: string }
  | {
      country: string;
      division: string;
      city: string;
      timezone: string;
      phoneCode: string;
      area: string;
      digits: number;
    };

const mx = (state: string, municipality: string, area: string, timezone = 'America/Mexico_City') =>
  ({ country: 'MX', state, municipality, timezone, area }) as const;

export const DEMO_PLACES = {
  cdmx_coyoacan: mx('09', '003', '55'),
  cdmx_tlalpan: mx('09', '012', '55'),
  cdmx_iztapalapa: mx('09', '007', '55'),
  cdmx_cuauhtemoc: mx('09', '015', '55'),
  cdmx_bj: mx('09', '014', '55'),
  cdmx_xochimilco: mx('09', '013', '55'),
  oax_oaxaca: mx('20', '067', '951'),
  oax_xoxocotlan: mx('20', '385', '951'),
  oax_pochutla: mx('20', '324', '958'),
  chis_sclc: mx('07', '078', '967'),
  chis_tuxtla: mx('07', '101', '961'),
  chis_comitan: mx('07', '019', '963'),
  jal_gdl: mx('14', '039', '33'),
  jal_zapopan: mx('14', '120', '33'),
  jal_tlaquepaque: mx('14', '098', '33'),
  yuc_merida: mx('31', '050', '999', 'America/Merida'),
  yuc_valladolid: mx('31', '102', '985', 'America/Merida'),
  qroo_fcp: mx('23', '002', '983', 'America/Cancun'),
  qroo_cancun: mx('23', '005', '998', 'America/Cancun'),
  mor_tepoztlan: mx('17', '020', '739'),
  mor_cuernavaca: mx('17', '007', '777'),
  pue_puebla: mx('21', '114', '222'),
  pue_cuetzalan: mx('21', '043', '233'),
  ver_xalapa: mx('30', '087', '228'),
  ver_coatepec: mx('30', '038', '228'),
  mich_morelia: mx('16', '053', '443'),
  mich_patzcuaro: mx('16', '066', '434'),
  qro_queretaro: mx('22', '014', '442'),
  gto_sma: mx('11', '003', '415'),
  gto_guanajuato: mx('11', '015', '473'),
  nl_monterrey: mx('19', '039', '81', 'America/Monterrey'),
  bcs_lapaz: mx('03', '003', '612', 'America/Mazatlan'),
  hgo_pachuca: mx('13', '048', '771'),
  edomex_texcoco: mx('15', '099', '595'),
  edomex_toluca: mx('15', '106', '722'),
  gro_chilpancingo: mx('12', '029', '747'),
  son_hermosillo: mx('26', '030', '662', 'America/Hermosillo'),
  co_medellin: {
    country: 'CO',
    division: 'Antioquia',
    city: 'Medellín',
    timezone: 'America/Bogota',
    phoneCode: '+57',
    area: '30',
    digits: 10,
  },
  co_bogota: {
    country: 'CO',
    division: 'Cundinamarca',
    city: 'Bogotá',
    timezone: 'America/Bogota',
    phoneCode: '+57',
    area: '31',
    digits: 10,
  },
  es_granada: {
    country: 'ES',
    division: 'Granada',
    city: 'Granada',
    timezone: 'Europe/Madrid',
    phoneCode: '+34',
    area: '6',
    digits: 9,
  },
  us_la: {
    country: 'US',
    division: 'California',
    city: 'Los Ángeles',
    timezone: 'America/Los_Angeles',
    phoneCode: '+1',
    area: '323',
    digits: 10,
  },
  us_austin: {
    country: 'US',
    division: 'Texas',
    city: 'Austin',
    timezone: 'America/Chicago',
    phoneCode: '+1',
    area: '512',
    digits: 10,
  },
  gt_antigua: {
    country: 'GT',
    division: 'Sacatepéquez',
    city: 'Antigua Guatemala',
    timezone: 'America/Guatemala',
    phoneCode: '+502',
    area: '5',
    digits: 8,
  },
} satisfies Record<string, DemoPlace>;

export type DemoPlaceKey = keyof typeof DEMO_PLACES;

export interface DemoPerson {
  fullName: string;
  sex: 'F' | 'M';
  place: DemoPlaceKey;
  age: number;
  /** Organización / colectivo (postulaciones). */
  org: string;
  role: string;
  /** Comunidad o territorio donde trabaja (textos de postulación). */
  territory: string;
}

/**
 * 60 personas. El ÍNDICE importa: `prisma/demo-data.ts` asigna escenarios por posición
 * (57 y 58 quedan sin verificar; 59 deshabilitada).
 */
// prettier-ignore
export const DEMO_PEOPLE: DemoPerson[] = [
  { fullName: 'Mariana López Hernández', sex: 'F', place: 'cdmx_coyoacan', age: 34, org: 'Huerto Tlatelolco', role: 'Coordinadora de huertos', territory: 'Coyoacán' },
  { fullName: 'José Luis Ramírez Torres', sex: 'M', place: 'jal_gdl', age: 41, org: 'Ingeniería Ambiental del Occidente', role: 'Consultor', territory: 'la zona metropolitana de Guadalajara' },
  { fullName: 'Daniela Cruz Martínez', sex: 'F', place: 'oax_oaxaca', age: 29, org: 'Colectivo Agua y Maíz', role: 'Promotora comunitaria', territory: 'los Valles Centrales de Oaxaca' },
  { fullName: 'Alejandro Gómez Santiago', sex: 'M', place: 'pue_puebla', age: 38, org: 'Arquitectura Viva', role: 'Arquitecto', territory: 'Puebla' },
  { fullName: 'Fernanda Ruiz Castillo', sex: 'F', place: 'mor_tepoztlan', age: 45, org: 'Ecoaldea Amatlán', role: 'Socia fundadora', territory: 'Tepoztlán' },
  { fullName: 'Juan Camilo Restrepo Gil', sex: 'M', place: 'co_medellin', age: 33, org: 'Corporación Cuenca Verde', role: 'Ingeniero sanitario', territory: 'el Valle de Aburrá' },
  { fullName: 'Gabriela Ortega Sandoval', sex: 'F', place: 'us_la', age: 36, org: 'Raíces Urban Farm', role: 'Educadora ambiental', territory: 'el este de Los Ángeles' },
  { fullName: 'Ricardo Méndez Flores', sex: 'M', place: 'qro_queretaro', age: 50, org: 'Constructora Méndez', role: 'Director técnico', territory: 'el semidesierto queretano' },
  { fullName: 'Sofía Hernández Aguilar', sex: 'F', place: 'ver_xalapa', age: 27, org: 'Universidad Veracruzana', role: 'Estudiante de maestría', territory: 'la cuenca del río Pixquiac' },
  { fullName: 'Héctor Vázquez Morales', sex: 'M', place: 'mich_morelia', age: 44, org: 'Escuela Secundaria Técnica 12', role: 'Docente de ciencias', territory: 'Morelia' },
  { fullName: 'Paola Jiménez Ríos', sex: 'F', place: 'nl_monterrey', age: 31, org: 'Fondo de Agua Metropolitano', role: 'Analista de proyectos', territory: 'Monterrey' },
  { fullName: 'Itzel Pérez Chan', sex: 'F', place: 'yuc_merida', age: 26, org: 'Cenotes Limpios A.C.', role: 'Voluntaria', territory: 'el anillo de cenotes de Yucatán' },
  { fullName: 'Rosa María Santiago López', sex: 'F', place: 'oax_xoxocotlan', age: 52, org: 'Comité de Agua Potable de Xoxocotlán', role: 'Tesorera', territory: 'Santa Cruz Xoxocotlán' },
  { fullName: 'Luis Fernando Castro Díaz', sex: 'M', place: 'chis_sclc', age: 39, org: 'Red de Saneamiento de Los Altos', role: 'Técnico comunitario', territory: 'Los Altos de Chiapas' },
  { fullName: 'Guadalupe Hernández Pérez', sex: 'F', place: 'chis_tuxtla', age: 47, org: 'Mujeres Sembradoras de Agua', role: 'Presidenta', territory: 'la cuenca del Sabinal' },
  { fullName: 'Carlos Alberto Medina Ruiz', sex: 'M', place: 'gto_sma', age: 55, org: 'Rancho Las Cañadas', role: 'Productor agroecológico', territory: 'San Miguel de Allende' },
  { fullName: 'Valeria Domínguez Soto', sex: 'F', place: 'cdmx_tlalpan', age: 30, org: 'Isla Urbana', role: 'Instaladora', territory: 'Tlalpan' },
  { fullName: 'Miguel Ángel Reyes Cortés', sex: 'M', place: 'gro_chilpancingo', age: 42, org: 'Cooperativa Agua de la Montaña', role: 'Coordinador', territory: 'la Montaña de Guerrero' },
  { fullName: 'Ana Karen Morales Vega', sex: 'F', place: 'hgo_pachuca', age: 28, org: 'Municipio de Pachuca', role: 'Técnica de medio ambiente', territory: 'Pachuca' },
  { fullName: 'Diego Armando Silva Luna', sex: 'M', place: 'edomex_texcoco', age: 35, org: 'Lago de Texcoco Vivo', role: 'Biólogo', territory: 'el ex lago de Texcoco' },
  { fullName: 'Lucía Fernández Navarro', sex: 'F', place: 'jal_zapopan', age: 37, org: 'Bosque La Primavera A.C.', role: 'Educadora', territory: 'el Bosque La Primavera' },
  { fullName: 'Andrés Torres Villalobos', sex: 'M', place: 'son_hermosillo', age: 46, org: 'Desierto Verde', role: 'Ingeniero agrónomo', territory: 'el desierto de Sonora' },
  { fullName: 'Natalia Ramos Guerrero', sex: 'F', place: 'cdmx_bj', age: 33, org: 'Estudio Cauce', role: 'Diseñadora de paisaje', territory: 'la Ciudad de México' },
  { fullName: 'Emiliano Sánchez Rojas', sex: 'M', place: 'mor_cuernavaca', age: 29, org: 'Barrancas Vivas', role: 'Gestor ambiental', territory: 'las barrancas de Cuernavaca' },
  { fullName: 'Carmen Martín García', sex: 'F', place: 'es_granada', age: 40, org: 'Acequias de la Alpujarra', role: 'Técnica de regadío', territory: 'la Alpujarra' },
  { fullName: 'Brenda Alejandra Cruz Ortiz', sex: 'F', place: 'qroo_fcp', age: 32, org: 'U Yóol Ha’', role: 'Promotora maya', territory: 'Felipe Carrillo Puerto' },
  { fullName: 'Óscar Jiménez Velasco', sex: 'M', place: 'pue_cuetzalan', age: 48, org: 'Cooperativa Tosepan', role: 'Técnico de saneamiento', territory: 'la Sierra Nororiental de Puebla' },
  { fullName: 'Mónica Salazar Pineda', sex: 'F', place: 'ver_coatepec', age: 36, org: 'Café y Agua Coatepec', role: 'Productora de café', territory: 'Coatepec' },
  { fullName: 'Jorge Eduardo Ramírez Lara', sex: 'M', place: 'bcs_lapaz', age: 43, org: 'Niparajá', role: 'Coordinador de cuencas', territory: 'la cuenca de La Paz' },
  { fullName: 'Karla Patricia Núñez Ibarra', sex: 'F', place: 'edomex_toluca', age: 31, org: 'Ríos de Toluca', role: 'Ingeniera civil', territory: 'el Alto Lerma' },
  { fullName: 'Adriana Moreno Castañeda', sex: 'F', place: 'mich_patzcuaro', age: 39, org: 'Comunidad Purépecha de Janitzio', role: 'Representante comunal', territory: 'el lago de Pátzcuaro' },
  { fullName: 'Tomás Hernández Cruz', sex: 'M', place: 'oax_pochutla', age: 27, org: 'Costa Oaxaqueña Sustentable', role: 'Promotor', territory: 'la costa de Oaxaca' },
  { fullName: 'Elena Guzmán Robles', sex: 'F', place: 'cdmx_xochimilco', age: 44, org: 'Chinampa Refugio', role: 'Chinampera', territory: 'las chinampas de Xochimilco' },
  { fullName: 'Raúl Ortiz Mendoza', sex: 'M', place: 'yuc_valladolid', age: 52, org: 'Ejido Xocén', role: 'Comisario ejidal', territory: 'el oriente de Yucatán' },
  { fullName: 'Claudia Ivonne Ríos Pacheco', sex: 'F', place: 'gto_guanajuato', age: 38, org: 'Guanajuato Hídrico', role: 'Investigadora', territory: 'la cuenca de la Independencia' },
  { fullName: 'Felipe de Jesús Aguilar', sex: 'M', place: 'chis_comitan', age: 46, org: 'Lagos de Montebello A.C.', role: 'Guardaparque', territory: 'los Lagos de Montebello' },
  { fullName: 'Sandra Luz Martínez Olvera', sex: 'F', place: 'qro_queretaro', age: 41, org: 'Sierra Gorda Viva', role: 'Educadora comunitaria', territory: 'la Sierra Gorda' },
  { fullName: 'Martha Elena Gutiérrez Luna', sex: 'F', place: 'oax_oaxaca', age: 57, org: 'Comités de Agua de la Mixteca', role: 'Asesora', territory: 'la Mixteca Alta' },
  { fullName: 'Iván Cortés Bautista', sex: 'M', place: 'cdmx_iztapalapa', age: 30, org: 'Iztapalapa Capta Lluvia', role: 'Coordinador vecinal', territory: 'Iztapalapa' },
  { fullName: 'Ximena Rodríguez Paredes', sex: 'F', place: 'jal_tlaquepaque', age: 24, org: 'Jóvenes por el Santiago', role: 'Voluntaria', territory: 'el río Santiago' },
  { fullName: 'Santiago Morales Uc', sex: 'M', place: 'yuc_merida', age: 22, org: 'Colectivo Ja’ Kuxtal', role: 'Estudiante', territory: 'Mérida' },
  { fullName: 'Andrea Lucía Pérez Xicará', sex: 'F', place: 'gt_antigua', age: 25, org: 'Asociación Agua Viva Sacatepéquez', role: 'Facilitadora', territory: 'Sacatepéquez' },
  { fullName: 'Kevin Alexis Domínguez Mora', sex: 'M', place: 'ver_xalapa', age: 21, org: 'Brigada Universitaria del Agua', role: 'Estudiante', territory: 'Xalapa' },
  { fullName: 'Jaqueline Hernández Gómez', sex: 'F', place: 'chis_sclc', age: 23, org: 'Jóvenes Tzotziles por el Agua', role: 'Promotora', territory: 'Chamula' },
  { fullName: 'Rodrigo Vargas Ek', sex: 'M', place: 'qroo_cancun', age: 26, org: 'Manglares Cancún', role: 'Técnico ambiental', territory: 'la laguna Nichupté' },
  { fullName: 'Citlali Ramírez Mendoza', sex: 'F', place: 'pue_puebla', age: 24, org: 'Atoyac Vivo', role: 'Estudiante de biología', territory: 'el río Atoyac' },
  { fullName: 'Abril Sánchez Toledo', sex: 'F', place: 'oax_oaxaca', age: 27, org: 'Semillas de Agua Oaxaca', role: 'Coordinadora juvenil', territory: 'la Sierra Norte de Oaxaca' },
  { fullName: 'Erick Daniel Solís Román', sex: 'M', place: 'mor_cuernavaca', age: 29, org: 'Huertos Escolares Morelos', role: 'Tallerista', territory: 'Morelos' },
  { fullName: 'Juana Inés Pérez Gómez', sex: 'F', place: 'chis_sclc', age: 35, org: 'Cooperativa de Mujeres Tejedoras', role: 'Lideresa', territory: 'San Cristóbal de las Casas' },
  { fullName: 'María de los Ángeles Cruz Ruiz', sex: 'F', place: 'oax_xoxocotlan', age: 42, org: 'Red de Mujeres del Valle', role: 'Coordinadora', territory: 'el Valle de Zaachila' },
  { fullName: 'Yolanda Ramírez Tzab', sex: 'F', place: 'yuc_valladolid', age: 39, org: 'Mujeres Mayas del Agua', role: 'Promotora', territory: 'Valladolid' },
  { fullName: 'Teresa Gómez Hernández', sex: 'F', place: 'gro_chilpancingo', age: 46, org: 'Unión de Mujeres de la Montaña', role: 'Lideresa comunitaria', territory: 'Chilpancingo' },
  { fullName: 'Laura Valentina Ospina', sex: 'F', place: 'co_bogota', age: 31, org: 'Humedales Bogotá', role: 'Ecóloga', territory: 'los humedales de Bogotá' },
  { fullName: 'Patricio Leal Garza', sex: 'M', place: 'nl_monterrey', age: 37, org: 'Agua para Todos NL', role: 'Ingeniero hidráulico', territory: 'Nuevo León' },
  { fullName: 'Beatriz Olmedo Fuentes', sex: 'F', place: 'cdmx_cuauhtemoc', age: 49, org: 'Escuela Activa Roma', role: 'Directora', territory: 'la colonia Roma' },
  { fullName: 'Daniel Rivera Castro', sex: 'M', place: 'us_austin', age: 34, org: 'Hill Country Rainwater', role: 'Instalador', territory: 'Texas Hill Country' },
  { fullName: 'Gerardo Lozano Pérez', sex: 'M', place: 'son_hermosillo', age: 40, org: 'Sonora Regenerativa', role: 'Productor', territory: 'Hermosillo' },
  { fullName: 'Renata Chávez Molina', sex: 'F', place: 'cdmx_coyoacan', age: 26, org: '—', role: '—', territory: 'Coyoacán' },
  { fullName: 'Samuel Ibáñez Torres', sex: 'M', place: 'jal_gdl', age: 33, org: '—', role: '—', territory: 'Guadalajara' },
  { fullName: 'Rocío Villanueva Soto', sex: 'F', place: 'mor_tepoztlan', age: 51, org: 'Casa del Agua Tepoztlán', role: 'Facilitadora', territory: 'Tepoztlán' },
];

/** Personas en listas de Moodle que aún no crean su cuenta (solo correo). */
export const DEMO_ROSTER_ONLY_EMAILS = [
  'hilda.serrano',
  'ramon.tec',
  'zoe.bautista',
  'octavio.lima',
];

// --- Textos de postulación -------------------------------------------------------------------

const LETTER_INTRO = [
  (p: DemoPerson) =>
    `Mi nombre es ${p.fullName} y desde hace varios años formo parte de ${p.org}, donde me desempeño como ${p.role.toLowerCase()}. En ${p.territory} vivimos de cerca la escasez de agua en temporada de secas y la contaminación de los cuerpos de agua que antes nos daban vida.`,
  (p: DemoPerson) =>
    `Soy ${p.role.toLowerCase()} en ${p.org} y trabajo con familias de ${p.territory}. Nuestra comunidad depende de pipas durante buena parte del año, y las aguas grises de las viviendas terminan en la barranca sin ningún tratamiento.`,
  (p: DemoPerson) =>
    `Escribo esta carta como integrante de ${p.org}. Desde ${p.territory} acompañamos procesos comunitarios de cuidado del agua, pero nos hacen falta herramientas técnicas para diseñar soluciones que duren y que la gente pueda mantener por su cuenta.`,
];

const LETTER_PROBLEM = [
  'En los últimos tres años el manantial que abastece a la comunidad redujo su caudal a la mitad. Hemos intentado reforestar la parte alta de la cuenca, pero sin obras de infiltración ni captación de lluvia el esfuerzo no alcanza.',
  'Las escuelas de la zona no tienen agua suficiente para los sanitarios y varias han suspendido clases. Queremos instalar sistemas de captación y baños secos, pero necesitamos saber dimensionarlos correctamente y explicarlos a las familias.',
  'El río que atraviesa el pueblo recibe descargas domésticas sin tratar. Las autoridades no tienen presupuesto para una planta convencional, por lo que buscamos alternativas descentralizadas como humedales construidos y biofiltros.',
];

const LETTER_NEED =
  'Por la situación económica de mi familia y de la organización no me es posible cubrir el costo completo del diplomado. La beca representa la diferencia entre poder formarme o seguir aprendiendo solo por ensayo y error, con el riesgo de que las obras fallen y la comunidad pierda la confianza.';

const LETTER_PLAN = [
  'Me comprometo a compartir lo aprendido en talleres mensuales con vecinas y vecinos, y a desarrollar como proyecto final el diseño de un sistema de captación y tratamiento para el centro comunitario, que después construiremos en faena.',
  'Mi compromiso es replicar el contenido con el comité y con jóvenes de la comunidad, documentar el proceso y presentar como proyecto final un plan de regeneración hídrica que podamos gestionar ante el municipio.',
  'Con lo aprendido quiero formar un pequeño equipo técnico local y presentar como proyecto final un humedal construido para las viviendas de la parte baja, con un plan de mantenimiento a cargo de las propias familias.',
];

/** Carta de intención (800–4000 caracteres, HU-19). */
export function intentLetter(person: DemoPerson, variant: number): string {
  const text = [
    LETTER_INTRO[variant % LETTER_INTRO.length](person),
    LETTER_PROBLEM[variant % LETTER_PROBLEM.length],
    LETTER_NEED,
    LETTER_PLAN[(variant + 1) % LETTER_PLAN.length],
    'Agradezco de antemano la consideración del comité.',
  ].join('\n\n');
  return text.length >= 820
    ? text
    : `${text}\n\nCuento con el respaldo de mi organización para dedicar el tiempo que requiere el programa.`;
}

const EXPERIENCE = [
  (p: DemoPerson) =>
    `Desde hace tres años participo en ${p.org} como ${p.role.toLowerCase()}. He colaborado en la construcción de cisternas de ferrocemento, en jornadas de reforestación en ${p.territory} y en talleres de huertos escolares con riego por goteo. También apoyo en la organización de asambleas y en la difusión de las actividades en redes sociales del colectivo.`,
  (p: DemoPerson) =>
    `Mi experiencia está en el trabajo comunitario: con ${p.org} hemos levantado diagnósticos del agua en ${p.territory}, organizado faenas para limpiar arroyos y acompañado a familias en la instalación de filtros caseros. Además he facilitado talleres con niñas, niños y jóvenes sobre el ciclo del agua y el cuidado de los manantiales.`,
  (p: DemoPerson) =>
    `He participado en brigadas de monitoreo de calidad del agua con ${p.org}, tomando muestras y registrando resultados en ${p.territory}. También he colaborado en la construcción de un baño seco en la escuela primaria y en la campaña para recuperar un ojo de agua que estaba lleno de basura.`,
];

const MOTIVATION = [
  (p: DemoPerson) =>
    `Quiero participar porque en ${p.territory} el agua se está acabando y la gente joven casi no participa en las decisiones. Aprender a construir ecotecnologías en equipo me permitiría regresar con conocimientos prácticos, replicarlos con mi colectivo y animar a más jóvenes a involucrarse. Me comprometo a compartir todo lo aprendido y a documentar el proceso.`,
  (p: DemoPerson) =>
    `Me motiva la posibilidad de aprender de otras experiencias de México y Centroamérica y construir una red. En ${p.territory} tenemos muchas ganas pero poca formación técnica; con este programa podría coordinar la construcción de sistemas de captación en las escuelas de la zona y acompañar a mi organización en un proyecto de largo plazo.`,
  (p: DemoPerson) =>
    `Creo que el cuidado del agua empieza por la organización comunitaria. Quiero fortalecer mis capacidades para liderar proyectos en ${p.territory}, aprender a dimensionar obras sencillas y a gestionar recursos. Al regresar organizaría un ciclo de talleres con mujeres y jóvenes y daría seguimiento a las obras con el comité de agua.`,
];

export function openCallExperience(person: DemoPerson, variant: number): string {
  return EXPERIENCE[variant % EXPERIENCE.length](person);
}

export function openCallMotivation(person: DemoPerson, variant: number): string {
  return MOTIVATION[variant % MOTIVATION.length](person);
}

export const EVALUATION_COMMENTS = {
  APPROVE: [
    'Perfil sólido y con trabajo comunitario comprobable. La carta es clara y el proyecto final es viable.',
    'Muy buena vinculación territorial; recomiendo aprobar con el tipo solicitado.',
    'Experiencia práctica relevante y compromiso de réplica bien planteado.',
    'Evidencias claras. Su organización ya tiene obras funcionando, aprovechará mucho el programa.',
  ],
  NOT_SELECT: [
    'La carta es muy general y no se identifica un proyecto concreto. Sugerir que postule a la siguiente generación.',
    'No cumple con el perfil de vinculación comunitaria que pide la convocatoria.',
  ],
  UNSURE: [
    'Buen perfil, pero no queda claro si podrá cumplir con la disponibilidad de fines de semana. Revisar en entrevista.',
    'Tengo dudas sobre el porcentaje: el tipo solicitado parece alto para su situación. Comentar en sesión de comité.',
  ],
} as const;

export const ATTENDANCE_COMMENTS = [
  'Me llevo el método para calcular la demanda de agua de una vivienda.',
  'Muy útil el ejemplo del humedal en la escuela de Amatlán.',
  'Quiero aplicar el diagnóstico con mi comité esta semana.',
  'Me quedó claro cómo elegir las plantas para el biofiltro.',
  'Excelente sesión, gracias por compartir los planos.',
  'Las preguntas del grupo enriquecieron mucho la clase.',
  'Me llevo la tabla de dimensionamiento y la lista de materiales.',
];

export const MANUAL_ATTENDANCE_REASONS = [
  'Problemas de conexión: participó por llamada telefónica.',
  'Se conectó desde el celular de otra participante; confirmado en el pase de lista.',
  'No pudo registrar a tiempo por falta de internet en su comunidad.',
];

export interface DemoContactMessage {
  name: string;
  email: string;
  organization?: string;
  phone?: [string, string];
  subject: ContactSubject;
  projectType?: ContactProjectType;
  projectLocation?: string;
  service?: ContactService;
  message: string;
  origin: ContactOrigin;
  status: ContactStatus;
  internalNote?: string;
  daysAgo: number;
}

// prettier-ignore
export const DEMO_CONTACT_MESSAGES: DemoContactMessage[] = [
  { name: 'Hortensia Lara Ruiz', email: 'hortensia.lara', organization: 'Escuela Primaria Benito Juárez', phone: ['+52', '9512345671'], subject: 'SCHOOL', message: 'Buenas tardes, somos una escuela primaria en Etla, Oaxaca. ¿Ofrecen talleres para docentes sobre captación de lluvia? Nos interesa para el próximo ciclo escolar.', origin: 'CONTACT_PAGE', status: 'NEW', daysAgo: 0 },
  { name: 'Arturo Benítez', email: 'arturo.benitez', organization: 'Hotel Selva Maya', phone: ['+52', '9841122334'], subject: 'DESIGN_CONSULTING', projectType: 'COMMERCIAL', projectLocation: 'Tulum, Quintana Roo', service: 'WASTEWATER_TREATMENT_DESIGN', message: 'Tenemos un hotel boutique de 18 habitaciones y queremos sustituir la fosa séptica por un sistema de humedales. ¿Podrían cotizar el diseño y la supervisión de obra?', origin: 'DESIGN_CONSULTING_PAGE', status: 'NEW', daysAgo: 1 },
  { name: 'Lorena Castañeda', email: 'lorena.castaneda', subject: 'SCHOLARSHIPS_CALLS', message: 'Hola, quisiera saber si la beca del diplomado cubre también la entrega del proyecto final y si se puede postular desde Guatemala.', origin: 'LANDING', status: 'NEW', daysAgo: 1 },
  { name: 'Ejido San Isidro', email: 'ejido.sanisidro', organization: 'Ejido San Isidro', phone: ['+52', '4421239876'], subject: 'DESIGN_CONSULTING', projectType: 'PRODUCTIVE', projectLocation: 'Colón, Querétaro', service: 'INFILTRATION_REHYDRATION_DESIGN', message: 'Somos 40 ejidatarios con parcelas de temporal. Nos interesa diseñar obras de infiltración y bordos para recargar el acuífero. ¿Hacen visitas de diagnóstico?', origin: 'DESIGN_CONSULTING_PAGE', status: 'IN_PROGRESS', internalNote: 'Llamé el martes; agendamos visita de diagnóstico para la próxima semana. Enviar propuesta de honorarios.', daysAgo: 4 },
  { name: 'Valentina Ruiz Soto', email: 'valentina.ruiz', subject: 'SCHOOL', message: 'Me inscribí al curso de humedales pero no me llegó el correo de confirmación. ¿Me pueden ayudar?', origin: 'CONTACT_PAGE', status: 'ANSWERED', internalNote: 'El correo estaba en spam. Se le reenvió y ya ve el curso en Mi formación.', daysAgo: 6 },
  { name: 'Colectivo Tierra Fértil', email: 'tierra.fertil', organization: 'Colectivo Tierra Fértil', subject: 'REGENERATIVE_TECH_HAWA', message: 'Nos interesa conocer más sobre las tecnologías HAWA para comunidades rurales y si es posible una demostración en campo en la Huasteca.', origin: 'REGENERATIVE_TECH_PAGE', status: 'IN_PROGRESS', internalNote: 'Se compartió el dossier HAWA. Pendiente confirmar fecha de demostración con el área técnica.', daysAgo: 8 },
  { name: 'Marco Antonio Gil', email: 'marco.gil', phone: ['+52', '5544332211'], subject: 'DESIGN_CONSULTING', projectType: 'HOUSEHOLD', projectLocation: 'Tlalpan, CDMX', service: 'RAINWATER_HARVESTING_DESIGN', message: 'Quiero instalar un sistema de captación de lluvia en mi casa (techo de 120 m²). ¿Cuánto cuesta el diseño?', origin: 'DESIGN_CONSULTING_PAGE', status: 'ANSWERED', internalNote: 'Se le envió la ficha de servicio domiciliario y se le recomendó el curso de captación.', daysAgo: 11 },
  { name: 'Fundación Agua Clara', email: 'alianzas.aguaclara', organization: 'Fundación Agua Clara', subject: 'OTHER', message: 'Somos una fundación que financia proyectos de saneamiento rural. Nos gustaría explorar una alianza para becar a promotoras comunitarias en el próximo diplomado.', origin: 'ABOUT_PAGE', status: 'IN_PROGRESS', internalNote: 'Reunión con dirección agendada. Preparar propuesta de becas patrocinadas (10 lugares).', daysAgo: 13 },
  { name: 'Patricia Ochoa', email: 'patricia.ochoa', subject: 'SCHOLARSHIPS_CALLS', message: '¿Cuándo abre la siguiente convocatoria de Aprendices del Agua? Tengo 31 años, ¿puedo participar?', origin: 'LANDING', status: 'ANSWERED', internalNote: 'Se respondió: rango de edad 18–30. Se le sugirió Siembra de Agua.', daysAgo: 15 },
  { name: 'Municipio de Zaachila', email: 'ecologia.zaachila', organization: 'H. Ayuntamiento de Villa de Zaachila', phone: ['+52', '9517654321'], subject: 'DESIGN_CONSULTING', projectType: 'COLLECTIVE', projectLocation: 'Villa de Zaachila, Oaxaca', service: 'WATER_RESILIENCE_DIAGNOSTICS', message: 'La dirección de ecología solicita información para un diagnóstico de resiliencia hídrica en cinco localidades del municipio.', origin: 'CONTACT_PAGE', status: 'ANSWERED', internalNote: 'Propuesta enviada el lunes. Dar seguimiento en dos semanas.', daysAgo: 19 },
  { name: 'Promociones SEO Rápido', email: 'ventas.seo', subject: 'OTHER', message: 'Posicionamos su sitio en primer lugar de Google en 7 días. Precios especiales este mes.', origin: 'CONTACT_PAGE', status: 'ARCHIVED', internalNote: 'Spam.', daysAgo: 21 },
  { name: 'Ingrid Salas', email: 'ingrid.salas', organization: 'Universidad Iberoamericana Puebla', subject: 'SCHOOL', message: 'Coordinamos una materia de sustentabilidad y nos gustaría que su equipo diera una charla sobre baños secos a nuestro grupo.', origin: 'ABOUT_PAGE', status: 'ANSWERED', internalNote: 'Se les invitó a la masterclass gratuita y se ofreció una charla en enero.', daysAgo: 26 },
  { name: 'Ramiro Tun', email: 'ramiro.tun', phone: ['+52', '9991237788'], subject: 'DESIGN_CONSULTING', projectType: 'OTHER', projectLocation: 'Hunucmá, Yucatán', service: 'NOT_SURE', message: 'Tengo un terreno donde se encharca mucho en lluvias y en secas no hay agua. No sé qué servicio necesito.', origin: 'DESIGN_CONSULTING_PAGE', status: 'NEW', daysAgo: 2 },
  { name: 'Alicia Montes', email: 'alicia.montes', subject: 'OTHER', message: 'Muchas gracias por el curso de saneamiento ecológico, ya construimos nuestro baño seco. ¡Les comparto fotos pronto!', origin: 'CONTACT_PAGE', status: 'ARCHIVED', internalNote: 'Mensaje de agradecimiento; se compartió con el equipo docente.', daysAgo: 33 },
  { name: 'Cooperativa La Esperanza', email: 'coop.esperanza', organization: 'Cooperativa La Esperanza', subject: 'REGENERATIVE_TECH_HAWA', message: '¿Las tecnologías HAWA sirven para potabilizar agua de pozo con arsénico? Somos una cooperativa en la Comarca Lagunera.', origin: 'REGENERATIVE_TECH_PAGE', status: 'NEW', daysAgo: 3 },
];
