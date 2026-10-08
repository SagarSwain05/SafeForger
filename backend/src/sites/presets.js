// Pre-built digital-twin sites. One fictional sandbox plus real Indian industrial facilities
// referenced by their public names and locations so supervisors can pick a familiar context.
// All telemetry on these twins is SIMULATED; SafeForge is not affiliated with these operators
// and attributes no incidents to them.
const PRESETS = [
  { id: 'demo-refinery', name: 'SafeForge Demo Refinery', company: 'SafeForge (sandbox)', sector: 'refinery', city: 'Visakhapatnam', state: 'Andhra Pradesh', featured: true,
    description: 'Fictional sandbox plant used for the guided kill-chain demo.' },
  { id: 'rinl-vizag-steel', name: 'Visakhapatnam Steel Plant', company: 'Rashtriya Ispat Nigam Ltd (RINL)', sector: 'steel', city: 'Visakhapatnam', state: 'Andhra Pradesh' },
  { id: 'tata-steel-jamshedpur', name: 'Jamshedpur Works', company: 'Tata Steel', sector: 'steel', city: 'Jamshedpur', state: 'Jharkhand' },
  { id: 'sail-bhilai', name: 'Bhilai Steel Plant', company: 'Steel Authority of India Ltd (SAIL)', sector: 'steel', city: 'Bhilai', state: 'Chhattisgarh' },
  { id: 'jsw-vijayanagar', name: 'Vijayanagar Works', company: 'JSW Steel', sector: 'steel', city: 'Toranagallu, Ballari', state: 'Karnataka' },
  { id: 'hpcl-visakh', name: 'Visakh Refinery', company: 'Hindustan Petroleum Corporation Ltd (HPCL)', sector: 'refinery', city: 'Visakhapatnam', state: 'Andhra Pradesh' },
  { id: 'iocl-panipat', name: 'Panipat Refinery', company: 'Indian Oil Corporation Ltd (IOCL)', sector: 'refinery', city: 'Panipat', state: 'Haryana' },
  { id: 'bpcl-kochi', name: 'Kochi Refinery', company: 'Bharat Petroleum Corporation Ltd (BPCL)', sector: 'refinery', city: 'Kochi', state: 'Kerala' },
  { id: 'ril-jamnagar', name: 'Jamnagar Refinery', company: 'Reliance Industries Ltd', sector: 'refinery', city: 'Jamnagar', state: 'Gujarat' },
  { id: 'ongc-hazira', name: 'Hazira Gas Processing Complex', company: 'Oil and Natural Gas Corporation (ONGC)', sector: 'chemical', city: 'Surat', state: 'Gujarat' },
  { id: 'gail-pata', name: 'Pata Petrochemical Complex', company: 'GAIL (India) Ltd', sector: 'chemical', city: 'Auriya', state: 'Uttar Pradesh' },
  { id: 'ntpc-simhadri', name: 'Simhadri Super Thermal Power Station', company: 'NTPC Ltd', sector: 'power', city: 'Visakhapatnam', state: 'Andhra Pradesh' },
  { id: 'ntpc-vindhyachal', name: 'Vindhyachal Super Thermal Power Station', company: 'NTPC Ltd', sector: 'power', city: 'Singrauli', state: 'Madhya Pradesh' },
  { id: 'secl-gevra', name: 'Gevra Opencast Mine', company: 'South Eastern Coalfields Ltd (Coal India)', sector: 'mining', city: 'Korba', state: 'Chhattisgarh' },
  { id: 'acc-wadi', name: 'Wadi Cement Works', company: 'ACC Ltd', sector: 'cement', city: 'Wadi, Kalaburagi', state: 'Karnataka' },
  { id: 'maruti-manesar', name: 'Manesar Plant', company: 'Maruti Suzuki India Ltd', sector: 'automotive', city: 'Manesar', state: 'Haryana' },
  { id: 'tata-motors-pune', name: 'Pimpri Plant', company: 'Tata Motors Ltd', sector: 'automotive', city: 'Pune', state: 'Maharashtra' },
  { id: 'apsez-mundra', name: 'Mundra Port', company: 'Adani Ports and SEZ Ltd', sector: 'logistics', city: 'Mundra', state: 'Gujarat' },
  { id: 'demo-pharma', name: 'SafeForge Demo API Plant', company: 'SafeForge (sandbox)', sector: 'pharma', city: 'Hyderabad', state: 'Telangana',
    description: 'Fictional pharmaceutical sandbox plant.' },
  { id: 'demo-metro', name: 'SafeForge Demo Metro Site', company: 'SafeForge (sandbox)', sector: 'construction', city: 'Bengaluru', state: 'Karnataka',
    description: 'Fictional construction sandbox site.' },
];

module.exports = { PRESETS, DEFAULT_SITE_ID: 'demo-refinery' };
