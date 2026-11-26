import { randomUUID } from 'node:crypto';
import {
  baseRegistrationFee,
  earlyBirdDeadlineDate,
  earlyBirdDiscountRate,
  initialCourses,
  registrationDeadlineDate,
} from '../src/data.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mobilePattern = /^\+?[0-9\s-]{10,15}$/;

function hasUnsupportedControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x08 ||
      (codePoint >= 0x0b && codePoint <= 0x0c) ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f;
  });
}

function registrationError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode, publicMessage: message });
}

function normalizeText(value, field, maximumLength, { optional = false } = {}) {
  if (typeof value !== 'string') {
    if (optional && (value === null || value === undefined)) return '';
    throw registrationError(`${field} must be text.`, 400);
  }
  const text = value.normalize('NFKC').trim();
  if (hasUnsupportedControlCharacters(text)) {
    throw registrationError(`${field} contains unsupported characters.`, 400);
  }
  if (!text && !optional) throw registrationError(`${field} is required.`, 400);
  if (text.length > maximumLength) {
    throw registrationError(`${field} must be ${maximumLength} characters or fewer.`, 400);
  }
  return text;
}

function dateInIndia(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calculateRegistrationPrice(date = new Date()) {
  const registrationDate = dateInIndia(date);
  if (registrationDate > registrationDeadlineDate) {
    throw registrationError('Registration closed: the deadline was 31 December 2026.', 409);
  }

  const discountEligible = registrationDate <= earlyBirdDeadlineDate;
  const discountAmount = discountEligible
    ? Math.round(baseRegistrationFee * earlyBirdDiscountRate)
    : 0;
  return {
    discountEligible,
    baseFee: baseRegistrationFee,
    discountAmount,
    finalFee: baseRegistrationFee - discountAmount,
  };
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw registrationError('Registration data must be a JSON object.', 400);
  }

  const teamName = normalizeText(input.teamName, 'Team name', 80);
  const leaderName = normalizeText(input.leaderName, 'Team leader name', 100);
  const email = normalizeText(input.leaderEmail, 'Team leader email', 254).toLowerCase();
  const mobile = normalizeText(input.mobile, 'Mobile number', 20);
  const organisation = normalizeText(input.organisation, 'College or organisation', 150);
  const city = normalizeText(input.city, 'City', 100);
  const course = normalizeText(input.course, 'Course or track', 150);
  const food = normalizeText(input.food ?? '', 'Food requirements', 500, { optional: true });
  const accessibility = normalizeText(
    input.accessibility ?? '',
    'Accessibility requirements',
    500,
    { optional: true },
  );

  if (!emailPattern.test(email)) {
    throw registrationError('Enter a valid team leader email address.', 400);
  }
  const digits = mobile.replace(/\D/g, '');
  if (!mobilePattern.test(mobile) || digits.length < 10 || digits.length > 15) {
    throw registrationError('Enter a valid mobile number with 10 to 15 digits.', 400);
  }
  if (!initialCourses.some((item) => item.title === course)) {
    throw registrationError('Choose a valid course or hackathon track.', 400);
  }
  if (!Array.isArray(input.members) || input.members.length !== 4) {
    throw registrationError('Exactly 4 team members are required.', 400);
  }
  const members = input.members.map((member, index) => {
    if (!member || typeof member !== 'object' || Array.isArray(member)) {
      throw registrationError(`Participant ${index + 1} is invalid.`, 400);
    }
    const name = normalizeText(member.name, `Participant ${index + 1} name`, 100);
    const age = Number(member.age);
    if (!Number.isInteger(age) || age < 18 || age > 120) {
      throw registrationError('Every participant must be between 18 and 120 years old.', 400);
    }
    return { name, age };
  });

  if (input.consent !== true) {
    throw registrationError('You must accept the event rules and privacy notice.', 400);
  }

  return {
    teamName,
    leaderName,
    email,
    mobile,
    organisation,
    city,
    course,
    members,
    food,
    accessibility,
  };
}

function makeRegistrationId(date) {
  return `HRE-${dateInIndia(date).slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function createRegistrationService({ store, now = () => new Date() } = {}) {
  if (!store || typeof store.createRegistration !== 'function') {
    throw new TypeError('A registration store is required.');
  }

  async function register(input) {
    const values = validateInput(input);
    const createdAt = now();
    const price = calculateRegistrationPrice(createdAt);
    const registrationId = makeRegistrationId(createdAt);
    const record = {
      registration_id: registrationId,
      team_name: values.teamName,
      participant_name: values.leaderName,
      email: values.email,
      phone_number: values.mobile,
      college_name: values.organisation,
      city: values.city,
      course: values.course,
      members: values.members,
      food: values.food,
      accessibility: values.accessibility,
      registration_date: createdAt.toISOString(),
      registration_fee: price.baseFee,
      discount_eligible: price.discountEligible,
      discount_amount: price.discountAmount,
      final_amount: price.finalFee,
      payment_status: 'unpaid',
      attended: false,
      consent_accepted: true,
      consent_at: createdAt.toISOString(),
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
    };

    try {
      return await store.createRegistration(record);
    } catch (error) {
      if (error.code === 'registration-id-collision') {
        record.registration_id = makeRegistrationId(createdAt);
        return store.createRegistration(record);
      }
      throw error;
    }
  }

  return {
    getRegistration: (registrationId) => store.getRegistration(registrationId),
    listRegistrations: () => store.listRegistrations(),
    markAttendance: (registrationId, attended) => store.setAttendance(registrationId, attended),
    register,
  };
}
