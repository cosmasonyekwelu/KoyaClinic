/**
 * Doctor Working Schedules & Appointment Slot Generation Utility
 *
 * All scheduling calculations adhere strictly to the Africa/Lagos (WAT, UTC+1) timezone.
 */

// Clinic doctors with defined working schedules
const DOCTOR_SCHEDULES = [
  {
    id: 'dr-adebayo',
    name: 'Dr Adebayo Olufemi',
    specialty: 'General Practitioner',
    // Working days: 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday
    workingDays: [1, 2, 3, 4, 5],
    // Working hours in Africa/Lagos local time (WAT, UTC+1)
    startHour: 9, // 09:00 WAT
    startMinute: 0,
    endHour: 13, // 13:00 WAT
    endMinute: 0,
  },
  {
    id: 'dr-chioma',
    name: 'Dr Chioma Nwosu',
    specialty: 'Cardiologist',
    // Working days: Monday, Wednesday, Friday
    workingDays: [1, 3, 5],
    startHour: 10, // 10:00 WAT
    startMinute: 0,
    endHour: 15, // 15:00 WAT
    endMinute: 0,
  },
  {
    id: 'dr-folake',
    name: 'Dr Folake Adeleke',
    specialty: 'Pediatrician',
    // Working days: Tuesday, Thursday, Saturday (6 = Saturday)
    workingDays: [2, 4, 6],
    startHour: 9, // 09:00 WAT
    startMinute: 0,
    endHour: 14, // 14:00 WAT
    endMinute: 0,
  },
];

const TIMEZONE_OFFSET_HOURS = 1; // Africa/Lagos is UTC+1 year-round (no DST)

/**
 * Creates a UTC Date given year, month (1-based), day, hour, and minute in Africa/Lagos time.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @param {number} hour 0-23 (WAT)
 * @param {number} minute 0-59
 * @returns {Date}
 */
function createLagosDate(year, month, day, hour, minute) {
  // WAT is UTC+1, so UTC hour = WAT hour - 1
  return new Date(Date.UTC(year, month - 1, day, hour - TIMEZONE_OFFSET_HOURS, minute, 0, 0));
}

/**
 * Formats a Date object into a readable date string in Africa/Lagos timezone (YYYY-MM-DD).
 * @param {Date} date
 * @returns {string}
 */
function getLagosDateString(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Get day of the week in Africa/Lagos (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 * @param {Date} date
 * @returns {number}
 */
function getLagosDayOfWeek(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
  });
  const short = formatter.format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short];
}

/**
 * Generates slots for a doctor on a specific date given a slot duration in minutes.
 * @param {object} doctor
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} slotDurationMinutes Default 30
 * @returns {Array<{ id: string, provider: string, start: string, end: string }>}
 */
function generateSlotsForDoctorOnDate(doctor, year, month, day, slotDurationMinutes = 30) {
  const dateCheck = createLagosDate(year, month, day, doctor.startHour, doctor.startMinute);
  const dayOfWeek = getLagosDayOfWeek(dateCheck);

  if (!doctor.workingDays.includes(dayOfWeek)) {
    return [];
  }

  const slots = [];
  let currentStartMinutes = doctor.startHour * 60 + doctor.startMinute;
  const endMinutes = doctor.endHour * 60 + doctor.endMinute;

  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const dateSlug = `${yyyy}${mm}${dd}`;

  while (currentStartMinutes + slotDurationMinutes <= endMinutes) {
    const startH = Math.floor(currentStartMinutes / 60);
    const startM = currentStartMinutes % 60;
    const currentEndMinutes = currentStartMinutes + slotDurationMinutes;
    const endH = Math.floor(currentEndMinutes / 60);
    const endM = currentEndMinutes % 60;

    const startDate = createLagosDate(year, month, day, startH, startM);
    const endDate = createLagosDate(year, month, day, endH, endM);

    const timeSlug = `${String(startH).padStart(2, '0')}${String(startM).padStart(2, '0')}`;
    const id = `slot-${doctor.id}-${dateSlug}-${timeSlug}`;

    slots.push({
      id,
      provider: doctor.name,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });

    currentStartMinutes = currentEndMinutes;
  }

  return slots;
}

/**
 * Generates upcoming slots across multiple days for all doctors.
 * @param {object} options
 * @param {number} [options.daysAhead=14] Number of days into the future to generate
 * @param {number} [options.slotDurationMinutes=30] Default 30 minutes
 * @param {Date} [options.startDate] Starting date (defaults to tomorrow in Africa/Lagos)
 * @param {Array<object>} [options.doctors] Doctors to schedule (defaults to DOCTOR_SCHEDULES)
 * @returns {Array<{ id: string, provider: string, start: string, end: string }>}
 */
function generateUpcomingSlots(options = {}) {
  const {
    daysAhead = 14,
    slotDurationMinutes = 30,
    startDate,
    doctors = DOCTOR_SCHEDULES,
  } = options;

  let baseDate = startDate ? new Date(startDate) : new Date();
  // Ensure we start from the next day in Africa/Lagos
  baseDate = new Date(baseDate.getTime() + 24 * 60 * 60 * 1000);

  const allSlots = [];

  for (let i = 0; i < daysAhead; i++) {
    const targetDate = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = getLagosDateString(targetDate);
    const [y, m, d] = dateStr.split('-').map(Number);

    for (const doc of doctors) {
      const docSlots = generateSlotsForDoctorOnDate(doc, y, m, d, slotDurationMinutes);
      allSlots.push(...docSlots);
    }
  }

  // Sort earliest start first
  allSlots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return allSlots;
}

module.exports = {
  DOCTOR_SCHEDULES,
  createLagosDate,
  getLagosDateString,
  getLagosDayOfWeek,
  generateSlotsForDoctorOnDate,
  generateUpcomingSlots,
};
