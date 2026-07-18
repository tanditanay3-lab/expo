// Utility functions for Consign AI

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Generate a shipment number
 */
export function generateShipmentNumber(tenantCode: string, year: number, sequence: number): string {
  const yearStr = year.toString();
  const sequenceStr = sequence.toString().padStart(5, '0');
  return `${tenantCode}-${yearStr}-${sequenceStr}`;
}

/**
 * Format date for display
 */
export function formatDate(date: Date | string, format: string = 'YYYY-MM-DD'): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY':
      return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD HH:mm:ss':
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    case 'DD MMM YYYY':
      return `${day} ${getMonthName(d.getMonth())} ${year}`;
    default:
      return d.toISOString();
  }
}

/**
 * Get month name
 */
function getMonthName(month: number): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return months[month];
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency: string = 'INR', locale: string = 'en-IN'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch (error) {
    // Fallback for unsupported currencies
    const symbols: Record<string, string> = {
      INR: '₹',
      USD: '$',
      EUR: '€',
      GBP: '£',
      SGD: 'S$',
      AED: 'د.إ',
      SAR: '﷼',
      CAD: 'CA$',
      AUD: 'AU$'
    };
    
    const symbol = symbols[currency] || currency;
    return `${symbol} ${amount.toFixed(2)}`;
  }
}

/**
 * Calculate percentage
 */
export function calculatePercentage(value: number, total: number, decimals: number = 2): number {
  if (total === 0) return 0;
  return parseFloat(((value / total) * 100).toFixed(decimals));
}

/**
 * Round number to decimal places
 */
export function roundNumber(value: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Truncate text to max length
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Capitalize first letter
 */
export function capitalizeFirstLetter(text: string): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Capitalize all words
 */
export function capitalizeWords(text: string): string {
  if (!text) return '';
  return text.split(' ').map(word => capitalizeFirstLetter(word)).join(' ');
}

/**
 * Generate a random string
 */
export function generateRandomString(length: number = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a secure token
 */
export function generateSecureToken(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex').substring(0, length);
}

/**
 * Hash a string using bcrypt
 */
export async function hashString(text: string): Promise<string> {
  const bcrypt = require('bcrypt');
  return bcrypt.hash(text, 10);
}

/**
 * Compare a string with a hash
 */
export async function compareHash(text: string, hash: string): Promise<boolean> {
  const bcrypt = require('bcrypt');
  return bcrypt.compare(text, hash);
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone number format
 */
export function isValidPhone(phone: string): boolean {
  // Simple validation - at least 10 digits
  const phoneRegex = /^[\d\s\-\+\(\)]{10,}$/;
  return phoneRegex.test(phone);
}

/**
 * Validate GSTIN format (India)
 */
export function isValidGSTIN(gstin: string): boolean {
  // GSTIN format: 15 characters, first 2 are state code, next 10 are PAN, last 3 are entity code
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin);
}

/**
 * Validate PAN format (India)
 */
export function isValidPAN(pan: string): boolean {
  // PAN format: 10 characters, first 5 letters, next 4 numbers, last letter
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(pan);
}

/**
 * Validate HS Code format
 */
export function isValidHSCode(hsCode: string): boolean {
  // HS Code format: 6-10 digits
  const hsCodeRegex = /^[0-9]{6,10}$/;
  return hsCodeRegex.test(hsCode);
}

/**
 * Validate Incoterms
 */
export function isValidIncoterms(incoterms: string): boolean {
  const validIncoterms = [
    'EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
    'FAS', 'FOB', 'CFR', 'CIF'
  ];
  return validIncoterms.includes(incoterms);
}

/**
 * Validate currency code
 */
export function isValidCurrency(currency: string): boolean {
  // ISO 4217 currency codes are 3 uppercase letters
  const currencyRegex = /^[A-Z]{3}$/;
  return currencyRegex.test(currency);
}

/**
 * Get currency symbol
 */
export function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    SGD: 'S$',
    AED: 'د.إ',
    SAR: '﷼',
    CAD: 'CA$',
    AUD: 'AU$',
    JPY: '¥',
    CNY: '¥',
    HKD: 'HK$',
    MYR: 'RM',
    THB: '฿',
    IDR: 'Rp',
    PHP: '₱',
    VND: '₫',
    KRW: '₩',
    TWD: 'NT$',
    NZD: 'NZ$',
    ZAR: 'R',
    TRY: '₺',
    RUB: '₽',
    BRL: 'R$',
    MXN: 'MX$',
    ARS: 'AR$',
    CLP: 'CLP$',
    COP: 'COP$',
    PEN: 'S/.',
    VEF: 'Bs.F'
  };
  return symbols[currency] || currency;
}

/**
 * Get country name from country code
 */
export function getCountryName(countryCode: string): string {
  const countries: Record<string, string> = {
    IN: 'India',
    US: 'United States',
    GB: 'United Kingdom',
    DE: 'Germany',
    FR: 'France',
    IT: 'Italy',
    ES: 'Spain',
    NL: 'Netherlands',
    BE: 'Belgium',
    SE: 'Sweden',
    DK: 'Denmark',
    NO: 'Norway',
    FI: 'Finland',
    CH: 'Switzerland',
    AT: 'Austria',
    IE: 'Ireland',
    PT: 'Portugal',
    GR: 'Greece',
    PL: 'Poland',
    CZ: 'Czech Republic',
    HU: 'Hungary',
    RO: 'Romania',
    BG: 'Bulgaria',
    HR: 'Croatia',
    SK: 'Slovakia',
    SI: 'Slovenia',
    LT: 'Lithuania',
    LV: 'Latvia',
    EE: 'Estonia',
    CY: 'Cyprus',
    MT: 'Malta',
    LU: 'Luxembourg',
    IS: 'Iceland',
    LI: 'Liechtenstein',
    MC: 'Monaco',
    AD: 'Andorra',
    VA: 'Vatican City',
    SM: 'San Marino',
    GI: 'Gibraltar',
    GG: 'Guernsey',
    JE: 'Jersey',
    IM: 'Isle of Man',
    FO: 'Faroe Islands',
    GL: 'Greenland',
    AX: 'Aland Islands',
    SJ: 'Svalbard and Jan Mayen',
    CA: 'Canada',
    MX: 'Mexico',
    BR: 'Brazil',
    AR: 'Argentina',
    CL: 'Chile',
    CO: 'Colombia',
    PE: 'Peru',
    VE: 'Venezuela',
    EC: 'Ecuador',
    BO: 'Bolivia',
    UY: 'Uruguay',
    PY: 'Paraguay',
    GY: 'Guyana',
    SR: 'Suriname',
    GF: 'French Guiana',
    FK: 'Falkland Islands',
    AU: 'Australia',
    NZ: 'New Zealand',
    FJ: 'Fiji',
    PG: 'Papua New Guinea',
    SB: 'Solomon Islands',
    VU: 'Vanuatu',
    NC: 'New Caledonia',
    PF: 'French Polynesia',
    WF: 'Wallis and Futuna',
    CK: 'Cook Islands',
    NU: 'Niue',
    TK: 'Tokelau',
    TV: 'Tuvalu',
    KI: 'Kiribati',
    NR: 'Nauru',
    PN: 'Pitcairn',
    TO: 'Tonga',
    WS: 'Samoa',
    AS: 'American Samoa',
    GU: 'Guam',
    MP: 'Northern Mariana Islands',
    PR: 'Puerto Rico',
    VI: 'U.S. Virgin Islands',
    UM: 'U.S. Minor Outlying Islands',
    BM: 'Bermuda',
    KY: 'Cayman Islands',
    TC: 'Turks and Caicos Islands',
    VG: 'British Virgin Islands',
    AI: 'Anguilla',
    MS: 'Montserrat',
    AG: 'Antigua and Barbuda',
    BB: 'Barbados',
    DM: 'Dominica',
    DO: 'Dominican Republic',
    HT: 'Haiti',
    JM: 'Jamaica',
    TT: 'Trinidad and Tobago',
    BS: 'Bahamas',
    GD: 'Grenada',
    KN: 'Saint Kitts and Nevis',
    LC: 'Saint Lucia',
    VC: 'Saint Vincent and the Grenadines',
    SX: 'Sint Maarten',
    CW: 'Curaçao',
    AW: 'Aruba',
    BQ: 'Bonaire, Sint Eustatius and Saba',
    SS: 'South Sudan',
    SD: 'Sudan',
    SO: 'Somalia',
    DJ: 'Djibouti',
    ER: 'Eritrea',
    ET: 'Ethiopia',
    KE: 'Kenya',
    UG: 'Uganda',
    TZ: 'Tanzania',
    RW: 'Rwanda',
    BI: 'Burundi',
    CM: 'Cameroon',
    CF: 'Central African Republic',
    TD: 'Chad',
    CG: 'Republic of the Congo',
    CD: 'Democratic Republic of the Congo',
    EQ: 'Equatorial Guinea',
    GA: 'Gabon',
    ST: 'Sao Tome and Principe',
    GQ: 'Equatorial Guinea',
    CI: 'Ivory Coast',
    GH: 'Ghana',
    GM: 'Gambia',
    GW: 'Guinea-Bissau',
    LR: 'Liberia',
    ML: 'Mali',
    MR: 'Mauritania',
    NE: 'Niger',
    NG: 'Nigeria',
    SN: 'Senegal',
    SL: 'Sierra Leone',
    TG: 'Togo',
    BF: 'Burkina Faso',
    CV: 'Cape Verde',
    GM: 'Gambia',
    GN: 'Guinea',
    GW: 'Guinea-Bissau',
    LR: 'Liberia',
    ML: 'Mali',
    MR: 'Mauritania',
    NE: 'Niger',
    NG: 'Nigeria',
    SH: 'Saint Helena',
    SC: 'Seychelles',
    GM: 'Gambia'
  };
  return countries[countryCode] || countryCode;
}

/**
 * Get port name from port code
 */
export function getPortName(portCode: string): string {
  const ports: Record<string, string> = {
    INNHA: 'Nhava Sheva (JNPT)',
    INMAA: 'Chennai',
    INCCU: 'Cochin',
    INBOM: 'Mumbai',
    INCAL: 'Kolkata',
    INVIZ: 'Visakhapatnam',
    INMAN: 'Mangalore',
    INPIP: 'Pipavav',
    INHaz: 'Hazira',
    INKR: 'Krishnapatnam',
    USNYC: 'New York',
    USLAX: 'Los Angeles',
    USCHI: 'Chicago',
    USHOU: 'Houston',
    USMIA: 'Miami',
    USSEA: 'Seattle',
    USOAK: 'Oakland',
    USLGB: 'Long Beach',
    USSFO: 'San Francisco',
    NLRTM: 'Rotterdam',
    NLAMS: 'Amsterdam',
    BEANR: 'Antwerp',
    BEZEI: 'Zeebrugge',
    DEHAM: 'Hamburg',
    DEBRE: 'Bremen',
    DEWIL: 'Wilhelmshaven',
    FRLEH: 'Le Havre',
    FRMAR: 'Marseille',
    FRDUN: 'Dunkirk',
    GBLON: 'London',
    GBSOU: 'Southampton',
    GBFXT: 'Felixstowe',
    GBLIV: 'Liverpool',
    GBGLA: 'Glasgow',
    SGSPG: 'Singapore',
    CNSHA: 'Shanghai',
    CNNGP: 'Ningbo',
    CNSZX: 'Shenzhen',
    CNGZH: 'Guangzhou',
    CNTXG: 'Tianjin',
    CNQDG: 'Qingdao',
    HKHKG: 'Hong Kong',
    JPTOK: 'Tokyo',
    JPOSA: 'Osaka',
    JPYOK: 'Yokohama',
    KRINC: 'Incheon',
    KRBUS: 'Busan',
    TWTPE: 'Taipei',
    TWKHH: 'Kaohsiung',
    MYKUL: 'Kuala Lumpur',
    MYPEN: 'Penang',
    IDJKT: 'Jakarta',
    IDSUB: 'Surabaya',
    VNSGN: 'Ho Chi Minh City',
    VNHPH: 'Haiphong',
    THBKK: 'Bangkok',
    THLCH: 'Laem Chabang',
    PHMNL: 'Manila',
    PHCEB: 'Cebu',
    AEDXB: 'Dubai',
    AEAUH: 'Abu Dhabi',
    SAJED: 'Jeddah',
    SARUH: 'Riyadh',
    TRIST: 'Istanbul',
    TRIZM: 'Izmir',
    TRMERS: 'Mersin',
    ILTLV: 'Tel Aviv',
    ILHFA: 'Haifa',
    ILASD: 'Ashdod',
    ZAJNB: 'Johannesburg',
    ZADUR: 'Durban',
    ZACT: 'Cape Town',
    BRSSA: 'Santos',
    BRRIO: 'Rio de Janeiro',
    ARBUE: 'Buenos Aires',
    CLVAP: 'Valparaiso',
    COCTG: 'Cartagena',
    PECLL: 'Callao',
    UYMVD: 'Montevideo',
    PYASU: 'Asuncion',
    CLSCL: 'Santiago',
    AUMEL: 'Melbourne',
    AUSYD: 'Sydney',
    AUBNE: 'Brisbane',
    AUPER: 'Perth',
    AUADL: 'Adelaide',
    NZAKL: 'Auckland',
    NZWLG: 'Wellington',
    NZCHC: 'Christchurch'
  };
  return ports[portCode] || portCode;
}

/**
 * Get shipping line name from code
 */
export function getShippingLineName(code: string): string {
  const shippingLines: Record<string, string> = {
    MSC: 'Mediterranean Shipping Company',
    MAERSK: 'Maersk Line',
    CMA: 'CMA CGM',
    COSCO: 'COSCO Shipping',
    EVERGREEN: 'Evergreen Marine',
    HMM: 'HMM (Hyundai Merchant Marine)',
    ONE: 'Ocean Network Express',
    YANG: 'Yang Ming Marine Transport',
    PIL: 'Pacific International Lines',
    ZIM: 'ZIM Integrated Shipping Services',
    HAPAG: 'Hapag-Lloyd',
    OOCL: 'Orient Overseas Container Line',
    MOL: 'Mitsui O.S.K. Lines',
    NYK: 'Nippon Yusen Kaisha',
    KLINE: 'Kawasaki Kisen Kaisha',
    SAFMARINE: 'Safmarine',
    SAMUDERA: 'Samudera Shipping Line',
    RCL: 'Regional Container Lines',
    SIT: 'SITC Container Lines',
    TS: 'TS Lines',
    IRISL: 'Islamic Republic of Iran Shipping Lines',
    UASC: 'United Arab Shipping Company',
    ARKAS: 'Arkas Line',
    BOR: 'Borivoj',
    CONTSHIP: 'Contship Containerlines',
    DELMAS: 'Delmas',
    EIM: 'Eimskip',
    FEEDER: 'Feeder Lines',
    GRIMALDI: 'Grimaldi Lines',
    HAMBURG: 'Hamburg Sud',
    INDEPENDENT: 'Independent Container Line',
    KENSHIP: 'Kenship',
    KINGSTON: 'Kingston Container Terminal',
    LOGIN: 'Log-In Logistics',
    MACANDREW: 'MacAndrews',
    MCC: 'MCC Transport',
    MERCURY: 'Mercury Lines',
    NEPTUNE: 'Neptune Lines',
    NORASIA: 'Norasia',
    OEL: 'OEL Container Lines',
    PONL: 'PONL',
    REEDEREI: 'Reederei Blue Star',
    SEACON: 'Seacon Logistics',
    SEAGO: 'Seago Line',
    SFL: 'SFL Corporation',
    SM: 'SM Line',
    SWIRE: 'Swire Shipping',
    TML: 'TML Container Lines',
    UNIFEEDER: 'UniFeeder',
    WAN: 'Wan Hai Lines',
    XT: 'XT Shipping'
  };
  return shippingLines[code] || code;
}

/**
 * Get Incoterms description
 */
export function getIncotermsDescription(incoterms: string): string {
  const descriptions: Record<string, string> = {
    EXW: 'Ex Works (named place)',
    FCA: 'Free Carrier (named place)',
    CPT: 'Carriage Paid To (named place of destination)',
    CIP: 'Carriage and Insurance Paid To (named place of destination)',
    DAP: 'Delivered at Place (named place of destination)',
    DPU: 'Delivered at Place Unloaded (named place of destination)',
    DDP: 'Delivered Duty Paid (named place of destination)',
    FAS: 'Free Alongside Ship (named port of shipment)',
    FOB: 'Free On Board (named port of shipment)',
    CFR: 'Cost and Freight (named port of destination)',
    CIF: 'Cost, Insurance and Freight (named port of destination)'
  };
  return descriptions[incoterms] || incoterms;
}

/**
 * Get payment method description
 */
export function getPaymentMethodDescription(method: string): string {
  const descriptions: Record<string, string> = {
    lc: 'Letter of Credit',
    tt: 'Telegraphic Transfer',
    dd: 'Demand Draft',
    open_account: 'Open Account',
    cash: 'Cash Payment',
    other: 'Other'
  };
  return descriptions[method] || method;
}

/**
 * Get shipment stage description
 */
export function getShipmentStageDescription(stage: string): string {
  const descriptions: Record<string, string> = {
    draft: 'Draft - Shipment created, awaiting document generation',
    documents_generated: 'Documents Generated - All documents have been generated',
    compliance_screened: 'Compliance Screened - Compliance checks completed',
    buyer_verified: 'Buyer Verified - Buyer risk assessment completed',
    customs_classified: 'Customs Classified - HS code and duty calculation completed',
    ready_to_file: 'Ready to File - All checks completed, ready for filing',
    filed: 'Filed - Shipment has been filed',
    cancelled: 'Cancelled - Shipment has been cancelled'
  };
  return descriptions[stage] || stage;
}

/**
 * Get risk category description
 */
export function getRiskCategoryDescription(category: string): string {
  const descriptions: Record<string, string> = {
    low: 'Low Risk - Reliable buyer with good payment history',
    medium: 'Medium Risk - Buyer with moderate risk factors',
    high: 'High Risk - Buyer with significant risk factors',
    critical: 'Critical Risk - High-risk buyer, requires special attention'
  };
  return descriptions[category] || category;
}

/**
 * Get severity description
 */
export function getSeverityDescription(severity: string): string {
  const descriptions: Record<string, string> = {
    low: 'Low - No action required',
    medium: 'Medium - Review recommended',
    high: 'High - Approval required',
    critical: 'Critical - Immediate action required'
  };
  return descriptions[severity] || severity;
}

/**
 * Get status description
 */
export function getStatusDescription(status: string): string {
  const descriptions: Record<string, string> = {
    active: 'Active',
    on_hold: 'On Hold',
    completed: 'Completed',
    cancelled: 'Cancelled',
    pending: 'Pending',
    processing: 'Processing',
    failed: 'Failed',
    resolved: 'Resolved',
    verified: 'Verified',
    rejected: 'Rejected',
    flagged: 'Flagged',
    approved: 'Approved',
    edited: 'Edited',
    acknowledged: 'Acknowledged'
  };
  return descriptions[status] || status;
}

/**
 * Format file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if object is empty
 */
export function isEmpty(obj: any): boolean {
  if (obj === null || obj === undefined) return true;
  if (typeof obj === 'string') return obj.trim() === '';
  if (Array.isArray(obj)) return obj.length === 0;
  if (typeof obj === 'object') return Object.keys(obj).length === 0;
  return false;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge objects deeply
 */
export function deepMerge<T extends object, U extends object>(target: T, source: U): T & U {
  const output = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = { ...source[key] };
      }
    } else {
      output[key] = source[key];
    }
  }
  
  return output as T & U;
}

/**
 * Pick properties from an object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Omit properties from an object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    shouldRetry?: (error: any, attempt: number) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffFactor = 2,
    shouldRetry = () => true
  } = options;

  let attempt = 0;
  let lastError: any;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      if (attempt > maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt - 1),
        maxDelay
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Chunk an array into smaller arrays
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Group array items by a key
 */
export function groupBy<T extends Record<string, any>, K extends keyof T>(
  array: T[],
  key: K
): Record<string, T[]> {
  return array.reduce((result, item) => {
    const groupKey = String(item[key]);
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
    return result;
  }, {} as Record<string, T[]>);
}

/**
 * Get unique values from an array
 */
export function unique<T>(array: T[]): T[] {
  return Array.from(new Set(array));
}

/**
 * Flatten an array
 */
export function flatten<T>(array: T[][]): T[] {
  return array.reduce((result, item) => result.concat(item), [] as T[]);
}

/**
 * Get the difference between two arrays
 */
export function difference<T>(array1: T[], array2: T[]): T[] {
  const set2 = new Set(array2);
  return array1.filter(item => !set2.has(item));
}

/**
 * Get the intersection of two arrays
 */
export function intersection<T>(array1: T[], array2: T[]): T[] {
  const set2 = new Set(array2);
  return array1.filter(item => set2.has(item));
}

/**
 * Check if two objects are deeply equal
 */
export function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  if (obj1 === null || obj2 === null) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;
  
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  if (keys1.length !== keys2.length) return false;
  
  for (const key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }
  
  return true;
}

export default {
  generateId,
  generateShipmentNumber,
  formatDate,
  formatCurrency,
  calculatePercentage,
  roundNumber,
  truncateText,
  capitalizeFirstLetter,
  capitalizeWords,
  generateRandomString,
  generateSecureToken,
  hashString,
  compareHash,
  isValidEmail,
  isValidPhone,
  isValidGSTIN,
  isValidPAN,
  isValidHSCode,
  isValidIncoterms,
  isValidCurrency,
  getCurrencySymbol,
  getCountryName,
  getPortName,
  getShippingLineName,
  getIncotermsDescription,
  getPaymentMethodDescription,
  getShipmentStageDescription,
  getRiskCategoryDescription,
  getSeverityDescription,
  getStatusDescription,
  formatFileSize,
  isEmpty,
  deepClone,
  deepMerge,
  pick,
  omit,
  sleep,
  retry,
  chunkArray,
  groupBy,
  unique,
  flatten,
  difference,
  intersection,
  deepEqual
};
