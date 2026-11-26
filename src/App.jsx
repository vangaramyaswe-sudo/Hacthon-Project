import { useEffect, useState } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft, ArrowRight, Brain, CalendarDays, ChartNoAxesColumn, Check,
  ChevronRight, CircleDollarSign, Cloud, Code2, Copy, Database, Gift,
  MapPin, Menu, QrCode, Radio, Search, ShieldCheck, Smartphone, Trophy,
  Users, X, Bot, Link as LinkIcon, LogIn, LogOut, BookOpen, Mail,
  MessageSquare, HelpCircle, ClipboardList, Star,
} from 'lucide-react';
import {
  doc, setDoc,
} from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db, firebaseConfigured } from './firebase';
import {
  baseRegistrationFee, chiefGuest, chiefGuestFather, earlyBirdDeadline, earlyBirdDiscountRate,
  earlyBirdDeadlineDate, eventAddress, eventDate, faqs, initialCourses, initialStations, mapsUrl,
  organiserDesignation, organiserEmail as organiserEmailAddress, organiserName, registrationDeadline,
  registrationDeadlineDate,
} from './data';
import DocumentUpload from './DocumentUpload';
import FloatingChatbot from './FloatingChatbot';
import './App.css';

const iconMap = {
  Brain, Chart: ChartNoAxesColumn, Database, Code: Code2, Shield: ShieldCheck,
  Radio, Cloud, Link: LinkIcon, Bot, Smartphone,
};

const readLocal = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

async function apiRequest(url, options = {}, token = null) {
  const { headers: providedHeaders, ...requestOptions } = options;
  const headers = new Headers(providedHeaders || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...requestOptions, headers });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
  }
  return payload;
}

const todayAtLoad = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
}).format(new Date());

function Header() {
  const [open, setOpen] = useState(false);
  const nav = [
    ['Home', '/'], ['Register', '/register'], ['Courses', '/courses'],
    ['Documents', '/documents'], ['Event Details', '/event-details'], ['Location', '/location'],
    ['Stations', '/stations'], ['Feedback', '/feedback'],
  ];
  return (
    <header className="topbar">
      <Link className="brand" to="/" onClick={() => setOpen(false)}>
        <span className="brand-mark"><Trophy size={20} /></span>
        <span>Hackathon<span>2026</span></span>
      </Link>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? 'nav-links open' : 'nav-links'} aria-label="Main navigation">
        {nav.map(([label, path]) => (
          <NavLink key={label} to={path} end={path === '/'} onClick={() => setOpen(false)}>{label}</NavLink>
        ))}
        <Link className="nav-admin" to="/admin" onClick={() => setOpen(false)}>Organiser</Link>
      </nav>
      <aside className="chief-guest" aria-label="Chief guest">
        <span>Chief Guest</span>
        <strong>{chiefGuest}</strong>
        <small>S/o {chiefGuestFather}</small>
      </aside>
    </header>
  );
}

function SiteShell({ children }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <footer>
        <div className="footer-brand">
          <div className="brand"><span className="brand-mark"><Trophy size={20} /></span><span>Hackathon<span>2026</span></span></div>
          <p>Ideas grow when people build together.</p>
        </div>
        <div><h4>Explore</h4><Link to="/courses">Courses</Link><Link to="/stations">Stations</Link><Link to="/event-details">Event details</Link></div>
        <div><h4>Organisation</h4><Link to="/faq">FAQ</Link><Link to="/feedback">Feedback</Link><Link to="/admin">Organiser login</Link></div>
        <div>
          <h4>Contact organiser</h4>
          <strong>{organiserName}</strong>
          <p>{organiserDesignation}</p>
          <a href={`mailto:${organiserEmailAddress}`}>{organiserEmailAddress}</a>
        </div>
      </footer>
      <div className="copyright">© 2026 Hackathon Registration Event</div>
    </>
  );
}

function Hero() {
  return (
    <section className="hero" id="home">
      <div className="hero-copy">
        <span className="eyebrow"><span /> Registration open</span>
        <h1>Hackathon Registration <em>Event</em></h1>
        <p>Build bold ideas, meet your team and turn your skills into real solutions.</p>
        <div className="hero-actions">
          <Link className="button primary" to="/register">Register your team <ArrowRight size={17} /></Link>
          <Link className="button ghost" to="/courses">Explore courses</Link>
        </div>
        <div className="hero-points">
          <span><Users size={18} /> 4 participants per team</span>
          <span><CalendarDays size={18} /> Event: 5 Jan 2027</span>
          <span><CalendarDays size={18} /> Deadline: 31 Dec 2026</span>
        </div>
      </div>
      <div className="hero-art" aria-label="Hackathon illustration">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <div className="code-card">
          <div className="code-card-head"><span /><span /><span /></div>
          <div className="code-lines"><i /><i /><i /><i /><i /></div>
        </div>
        <div className="floating-card left-card"><Users /><strong>4</strong><span>Team members</span></div>
        <div className="floating-card right-card"><Gift /><strong>Free</strong><span>Pen + food</span></div>
        <div className="leaf leaf-a" /><div className="leaf leaf-b" />
      </div>
    </section>
  );
}

function HomeNavigation() {
  const cards = [
    ['Event Details', '/event-details', ClipboardList, 'Date, rules and event essentials'],
    ['Register Now', '/register', Users, 'Create and submit a four-member team'],
    ['Explore Courses', '/courses', BookOpen, 'Search tracks and course details'],
    ['Event Location', '/location', MapPin, 'Address, directions and QR code'],
    ['Explore Stations', '/stations', QrCode, 'Visit event stations and scan codes'],
    ['Feedback', '/feedback', MessageSquare, 'Share your event experience'],
    ['Contact Organiser', '/contact', Mail, 'Send a question or find contact details'],
    ['FAQ', '/faq', HelpCircle, 'Read frequently asked questions'],
  ];
  return (
    <section className="section home-navigation" aria-label="Website pages">
      <div className="section-heading">
        <span>Explore the event</span>
        <h2>Where would you like to go?</h2>
      </div>
      <div className="home-nav-grid">
        {cards.map(([title, path, Icon, description]) => (
          <Link className="home-nav-card" to={path} key={title}>
            <div className="icon-box"><Icon /></div>
            <div><h3>{title}</h3><p>{description}</p></div>
            <ArrowRight className="card-arrow" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function EventDetails() {
  const cards = [
    [CalendarDays, 'Registration deadline', registrationDeadline],
    [CalendarDays, 'Confirmed event date', eventDate],
    [Users, 'Team size', 'Exactly 4 participants'],
    [ShieldCheck, 'Minimum age', '18 years'],
    [Gift, 'Food & water', 'FREE for registered participants'],
    [Trophy, 'Attendance gift', 'One FREE pen'],
  ];
  return (
    <section className="section" id="event-details">
      <div className="section-heading">
        <span>Event essentials</span>
        <h2>Everything you need to know</h2>
      </div>
      <div className="detail-grid">
        {cards.map(([Icon, label, value]) => (
          <article className="detail-card" key={label}>
            <div className="icon-box"><Icon /></div>
            <div><p>{label}</p><strong>{value}</strong></div>
          </article>
        ))}
      </div>
      <div className="notice-card">
        <strong>Chief Guest</strong>
        <span>{chiefGuest} — S/o {chiefGuestFather}</span>
      </div>
    </section>
  );
}

function DiscountSection() {
  const eligible = todayAtLoad <= earlyBirdDeadlineDate;
  return (
    <section className="discount-section">
      <div className="discount-icon"><CircleDollarSign /></div>
      <div><span>Limited early registration</span><h2>REGISTER EARLY AND SAVE!</h2></div>
      <div className="discount-badge"><strong>10%</strong><span>OFF</span></div>
      <p>Register on or before <strong>{earlyBirdDeadline}</strong> and pay <strong>₹900</strong> instead of ₹1,000.</p>
      <span className={eligible ? 'live eligible' : 'live'}>{eligible ? 'Early bird is currently active' : 'Early bird period has ended'}</span>
    </section>
  );
}

function Registration() {
  const [selectedCourse] = useState(() => sessionStorage.getItem('selectedCourse') || '');
  const [submitted, setSubmitted] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const registrationClosed = todayAtLoad > registrationDeadlineDate;
  const discountEligible = todayAtLoad <= earlyBirdDeadlineDate && !registrationClosed;
  const feeNumber = baseRegistrationFee;
  const discount = discountEligible ? Math.round(feeNumber * earlyBirdDiscountRate) : 0;
  const formatRupees = (amount) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

  useEffect(() => {
    const handler = (event) => setSubmitted(event.detail);
    window.addEventListener('registration-confirmed', handler);
    return () => window.removeEventListener('registration-confirmed', handler);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (registrationClosed) return setError('Registration closed: the deadline was 31 December 2026.');
    const form = new FormData(event.currentTarget);
    const members = [1, 2, 3, 4].map((n) => ({
      name: form.get(`memberName${n}`)?.trim(),
      age: Number(form.get(`memberAge${n}`)),
    }));
    if (members.some((member) => !member.name || !member.age)) {
      return setError('Please enter a name and age for all 4 team members.');
    }
    if (members.some((member) => member.age < 18)) {
      return setError('Registration blocked: every participant must be 18 years or older.');
    }
    const email = form.get('leaderEmail').trim();
    const mobile = form.get('mobile').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid team leader email address.');
    if (!/^\+?[0-9\s-]{10,15}$/.test(mobile)) return setError('Enter a valid mobile number with 10 to 15 digits.');
    if (!form.get('consent')) return setError('You must accept the event rules and privacy notice.');

    setLoading(true);
    const registration = {
      teamName: form.get('teamName').trim(),
      leaderName: form.get('leaderName').trim(),
      leaderEmail: email,
      mobile,
      organisation: form.get('organisation').trim(),
      city: form.get('city').trim(),
      course: form.get('course'),
      members,
      food: form.get('food')?.trim() || 'No requirements provided',
      accessibility: form.get('accessibility')?.trim() || 'No requirements provided',
      consent: form.get('consent') === 'on',
    };
    try {
      const result = await apiRequest('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registration),
      });
      setSubmitted(result.registration);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (saveError) {
      setError(`Registration could not be saved: ${saveError.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <section className="section confirmation" id="register">
        <div className="success-ring"><Check /></div>
        <span>Registration confirmed</span>
        <h2>Welcome to the hackathon, {submitted.teamName}!</h2>
        <p>Your unique registration ID:</p>
        <strong className="registration-id">{submitted.id}</strong>
        <p>Registration fee: <strong>{`₹${Math.round(submitted.finalFee).toLocaleString('en-IN')}`}</strong></p>
        <p>Payment status: <strong>{submitted.paymentStatus === 'unpaid' ? 'Unpaid' : submitted.paymentStatus}</strong></p>
        <div className="confirmation-actions">
          <button className="button primary" onClick={() => window.print()}>Print confirmation</button>
          <button className="button ghost" onClick={() => setSubmitted(null)}>Register another team</button>
        </div>
        <small>Your registration has been saved. Payment is not marked complete until it is verified.</small>
      </section>
    );
  }

  return (
    <section className="section registration-section" id="register">
      <div className="registration-intro">
        <span className="eyebrow">Secure your spot</span>
        <h2>Register your team</h2>
        <p>Complete the details below. Registration closes on <strong>{registrationDeadline}</strong>. Event date: <strong>{eventDate}</strong>.</p>
        <div className="fee-box">
          <span>Registration fee</span>
          <strong>{discountEligible ? `${formatRupees(feeNumber - discount)} after 10% discount` : formatRupees(feeNumber)}</strong>
        </div>
      </div>
      <form className="registration-form" onSubmit={submit}>
        {registrationClosed && <div className="form-alert">Registration is closed.</div>}
        {error && <div className="form-alert error">{error}</div>}
        <div className="form-grid">
          <label>Team name *<input name="teamName" required placeholder="Enter your team name" /></label>
          <label>Team leader full name *<input name="leaderName" required placeholder="Full name" /></label>
          <label>Team leader email *<input name="leaderEmail" type="email" required placeholder="name@example.com" /></label>
          <label>Mobile number *<input name="mobile" required placeholder="+91 00000 00000" /></label>
          <label>College or organisation *<input name="organisation" required placeholder="Organisation name" /></label>
          <label>City *<input name="city" required placeholder="City" /></label>
          <label className="full">Selected course or hackathon track *
            <select name="course" defaultValue={selectedCourse} required>
              <option value="" disabled>Choose a course</option>
              {initialCourses.map((course) => <option key={course.id} value={course.title}>{course.title}</option>)}
            </select>
          </label>
        </div>
        <h3>Four team members</h3>
        <div className="member-grid">
          {[1, 2, 3, 4].map((n) => (
            <fieldset key={n}>
              <legend>Participant {n}</legend>
              <label>Full name *<input name={`memberName${n}`} required /></label>
              <label>Age *<input name={`memberAge${n}`} type="number" min="18" max="120" required /></label>
            </fieldset>
          ))}
        </div>
        <div className="form-grid">
          <label>Food preference or dietary requirements<textarea name="food" placeholder="Optional" /></label>
          <label>Accessibility requirements<textarea name="accessibility" placeholder="Optional" /></label>
        </div>
        <label className="consent"><input name="consent" type="checkbox" required /> I confirm that the team has read and accepted the event rules and privacy notice.</label>
        <button className="button primary submit-button" type="submit" disabled={loading || registrationClosed}>
          {loading ? 'Submitting...' : 'Submit registration'} <ArrowRight size={17} />
        </button>
      </form>
    </section>
  );
}

function Courses() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const courses = readLocal('courses', initialCourses);
  const categories = ['All', ...new Set(courses.map((course) => course.category))];
  const visible = courses.filter((course) =>
    (category === 'All' || course.category === category) &&
    `${course.title} ${course.intro}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <section className="section courses-page">
      <div className="page-heading"><span>Choose your path</span><h1>Explore our courses</h1><p>Find the track that matches your ideas and team skills.</p></div>
      <div className="course-tools">
        <label className="search-box"><Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search courses..." /></label>
        <div className="filters">{categories.map((item) => <button className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      </div>
      <div className="course-grid">
        {visible.map((course) => {
          const Icon = iconMap[course.icon] || Code2;
          return (
            <Link className="course-card" to={`/courses/${course.id}`} key={course.id}>
              <div className="course-icon"><Icon /></div>
              <span>{course.category}</span>
              <h3>{course.title}</h3>
              <p>{course.intro}</p>
              <div>View details <ArrowRight /></div>
            </Link>
          );
        })}
      </div>
      {visible.length === 0 && <div className="empty-state">No courses match your search.</div>}
    </section>
  );
}

function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const course = readLocal('courses', initialCourses).find((item) => item.id === id);
  if (!course) return <div className="section empty-state">Course not found. <Link to="/courses">Back to courses</Link></div>;
  const Icon = iconMap[course.icon] || Code2;
  const selectCourse = () => {
    sessionStorage.setItem('selectedCourse', course.title);
    navigate('/register');
  };
  const listSection = (title, items) => (
    <article className="detail-list"><h3>{title}</h3><ul>{items.map((item) => <li key={item}><Check /> {item}</li>)}</ul></article>
  );
  return (
    <section className="section course-detail">
      <Link className="back-link" to="/courses"><ArrowLeft /> Back to courses</Link>
      <div className="course-detail-hero">
        <div className="course-icon large"><Icon /></div>
        <div><span>{course.category}</span><h1>{course.title}</h1><p>{course.intro}</p></div>
      </div>
      <div className="course-overview">
        <article><h3>What it is about</h3><p>{course.about}</p></article>
        <article><h3>Why it is useful</h3><p>{course.useful}</p></article>
        <article><h3>Why choose this course</h3><p>{course.why}</p></article>
      </div>
      <div className="detail-list-grid">
        {listSection('What participants will learn', course.learn)}
        {listSection('Important topics', course.topics)}
        {listSection('Technologies and tools', course.tools)}
        {listSection('Practical projects', course.projects)}
        {listSection('Real-world applications', course.applications)}
        {listSection('Skills you can develop', course.skills)}
      </div>
      <div className="course-result-grid">
        <article><h3>Expected learning outcome</h3><p>{course.outcomes}</p></article>
        {listSection('Career opportunities', course.careers)}
      </div>
      <div className="course-actions">
        <button className="button primary" onClick={selectCourse}>Select this course</button>
        <button className="button dark" onClick={selectCourse}>Register for selected course</button>
      </div>
    </section>
  );
}

function LocationSection() {
  const copy = async () => {
    await navigator.clipboard.writeText(mapsUrl);
  };
  return (
    <section className="section location-section" id="location">
      <div className="location-copy">
        <span className="eyebrow">Find the venue</span>
        <h2>Event location</h2>
        <div className="address"><MapPin /><p>{eventAddress}</p></div>
        <div className="location-actions">
          <a className="button primary" href={mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps <ArrowRight size={17} /></a>
          <a className="button ghost" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(eventAddress)}`} target="_blank" rel="noreferrer">Get Directions</a>
          <button className="button soft" onClick={copy}><Copy size={17} /> Copy location link</button>
        </div>
      </div>
      <div className="qr-card">
        <QRCodeSVG value={mapsUrl} size={190} level="H" includeMargin />
        <span><QrCode size={16} /> Scan for Google Maps</span>
        <small>Address: {eventAddress}</small>
      </div>
    </section>
  );
}

function Stations() {
  const stations = readLocal('stations', initialStations);
  const publicUrl = import.meta.env.VITE_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const canGenerate = Boolean(publicUrl) && !publicUrl.includes('localhost');
  return (
    <section className="section stations-page" id="stations">
      <div className="page-heading">
        <span>Explore event stations</span>
        <h1>Follow the hackathon journey</h1>
        <p>Scan a station QR code or open each station directly.</p>
      </div>
      {!canGenerate && <div className="setup-note">Published station QR codes will be generated after VITE_PUBLIC_SITE_URL is set to the deployed website.</div>}
      <div className="station-grid">
        {stations.map((station, index) => {
          const stationUrl = `${publicUrl || window.location.origin}/#/stations/${station.id}`;
          return (
            <article className="station-card" key={station.id}>
              <div className="station-number">0{index + 1}</div>
              <h3>{station.name}</h3>
              <p>{station.description}</p>
              {canGenerate && <QRCodeSVG value={stationUrl} size={140} level="H" includeMargin />}
              <Link className="button ghost" to={`/stations/${station.id}`}>View station <ArrowRight size={16} /></Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stations = readLocal('stations', initialStations);
  const index = stations.findIndex((station) => station.id === id);
  if (index < 0) return <div className="section empty-state">Station not found.</div>;
  const station = stations[index];
  return (
    <section className="section station-detail">
      <Link className="back-link" to="/stations"><ArrowLeft /> Explore all stations</Link>
      <div className="station-progress"><span>Station {index + 1} of {stations.length}</span><div><i style={{ width: `${((index + 1) / stations.length) * 100}%` }} /></div></div>
      <div className="station-detail-card">
        <div className="station-number large-number">0{index + 1}</div>
        <h1>{station.name}</h1>
        <p>{station.description}</p>
        <div className="station-info-grid">
          <article><h3>Activities</h3><ul>{station.activities.map((item) => <li key={item}><Check /> {item}</li>)}</ul></article>
          <article><h3>Instructions</h3><p>{station.instructions}</p></article>
        </div>
      </div>
      <div className="station-navigation">
        <button className="button ghost" disabled={index === 0} onClick={() => navigate(`/stations/${stations[index - 1].id}`)}><ArrowLeft /> Previous station</button>
        <button className="button primary" disabled={index === stations.length - 1} onClick={() => navigate(`/stations/${stations[index + 1].id}`)}>Next station <ArrowRight /></button>
      </div>
    </section>
  );
}

function FAQPage() {
  const [openFaq, setOpenFaq] = useState(0);
  return (
    <section className="section faq-section">
      <div className="section-heading"><span>Need answers?</span><h1>Frequently asked questions</h1></div>
      <div className="faq-list">
        {faqs.map(([question, answer], index) => (
          <article className={openFaq === index ? 'faq open' : 'faq'} key={question}>
            <button onClick={() => setOpenFaq(openFaq === index ? -1 : index)}><span>{question}</span><ChevronRight /></button>
            {openFaq === index && <p>{answer}</p>}
          </article>
        ))}
      </div>
      <div className="faq-contact">
        <Link className="button ghost" to="/contact">Contact the organiser</Link>
      </div>
    </section>
  );
}

function ContactPage() {
  return (
    <section className="section contact-page">
      <div className="page-heading"><span>Get in touch</span><h1>Contact Organiser</h1></div>
      <article className="contact-card">
        <div className="course-icon"><Mail /></div>
        <h2>{organiserName}</h2>
        <p>{organiserDesignation}</p>
        <a className="button primary" href={`mailto:${organiserEmailAddress}`}>{organiserEmailAddress}</a>
      </article>
    </section>
  );
}

function Feedback() {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const submit = async (event) => {
    event.preventDefault();
    if (rating === 0) {
      setError('Please select an event rating from 1 to 5 stars.');
      return;
    }
    setError('');
    const form = new FormData(event.currentTarget);
    const record = {
      experience: form.get('experience'),
      rating: Number(form.get('rating')),
      registration: form.get('registration'),
      courses: form.get('courses'),
      food: form.get('food'),
      organisation: form.get('organisation'),
      liked: form.get('liked'),
      improvement: form.get('improvement'),
      participateAgain: form.get('participateAgain'),
      comments: form.get('comments'),
      createdAt: new Date().toISOString(),
    };
    try {
      const feedback = readLocal('feedback', []);
      localStorage.setItem('feedback', JSON.stringify([...feedback, record]));
      if (firebaseConfigured) await setDoc(doc(db, 'feedback', crypto.randomUUID()), record);
      setSubmitted(true);
    } catch (saveError) {
      setError(`Feedback could not be saved: ${saveError.message}`);
    }
  };
  if (submitted) return (
    <section className="section feedback-section" id="feedback"><div className="success-ring"><Check /></div><h2>Thank you for your feedback!</h2><p>Your response helps improve the next event.</p></section>
  );
  return (
    <section className="section feedback-section" id="feedback">
      <div className="section-heading"><span>Participant voice</span><h2>Share your experience</h2></div>
      {error && <div className="form-alert error">{error}</div>}
      <form className="feedback-form" onSubmit={submit}>
        <div className="form-grid">
          <label>How was your overall experience?<select name="experience" required><option value="">Choose</option><option>Excellent</option><option>Good</option><option>Average</option><option>Poor</option></select></label>
          <fieldset className="rating-field">
            <legend>How would you rate the event?</legend>
            <input name="rating" type="hidden" value={rating} />
            <div className="star-row" role="radiogroup" aria-label="Event rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  className={star <= rating ? 'star active' : 'star'}
                  onClick={() => setRating(star)}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                  aria-pressed={star === rating}
                  key={star}
                ><Star /></button>
              ))}
            </div>
          </fieldset>
          <label>Registration process<select name="registration" required><option value="">Choose</option><option>Excellent</option><option>Good</option><option>Average</option><option>Poor</option></select></label>
          <label>Courses and activities<select name="courses" required><option value="">Choose</option><option>Excellent</option><option>Good</option><option>Average</option><option>Poor</option></select></label>
          <label>Food arrangement<select name="food" required><option value="">Choose</option><option>Excellent</option><option>Good</option><option>Average</option><option>Poor</option><option>Not applicable</option></select></label>
          <label>Event organisation<select name="organisation" required><option value="">Choose</option><option>Excellent</option><option>Good</option><option>Average</option><option>Poor</option></select></label>
        </div>
        <label>What did you like most?<textarea name="liked" placeholder="Optional" /></label>
        <label>Suggestions for next time<textarea name="improvement" placeholder="Share your suggestions" /></label>
        <label>Would you participate again?<select name="participateAgain" required><option value="">Choose</option><option>Yes</option><option>Maybe</option><option>No</option></select></label>
        <label>Additional comments<textarea name="comments" placeholder="Optional" /></label>
        <button className="button primary" type="submit">Submit feedback</button>
      </form>
    </section>
  );
}

function Admin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [registrations, setRegistrations] = useState([]);
  const [feedback, setFeedback] = useState(() => readLocal('feedback', []));
  const [search, setSearch] = useState('');
  const [attendanceLoadingId, setAttendanceLoadingId] = useState(null);
  const [eventDateSetting, setEventDateSetting] = useState(() =>
    readLocal('eventSettings', { eventDate: '2027-01-05' }).eventDate ?? '2027-01-05');
  const [registrationDeadlineSetting, setRegistrationDeadlineSetting] = useState(() =>
    readLocal('eventSettings', { registrationDeadline: '2026-12-31' }).registrationDeadline ?? '2026-12-31');
  const [organiserEmail, setOrganiserEmail] = useState(() =>
    readLocal('eventSettings', { organiserEmail: organiserEmailAddress }).organiserEmail ?? organiserEmailAddress);

  const login = async (event) => {
    event.preventDefault();
    setError('');
    if (!firebaseConfigured) {
      setError('Firebase is not configured. Add your Firebase web app values to .env.local before organiser login.');
      return;
    }
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const token = await result.user.getIdToken();
      const [registrationResult, feedbackResult] = await Promise.all([
        apiRequest('/api/registrations', {}, token),
        apiRequest('/api/feedback', {}, token),
      ]);
      setRegistrations(registrationResult.registrations);
      setFeedback(feedbackResult.feedback);
      setUser(result.user);
    } catch (loginError) {
      setError(loginError.code === 'auth/invalid-credential'
        ? 'The email or password is incorrect.'
        : `Login unavailable: ${loginError.message}`);
    }
  };

  const logout = async () => {
    if (firebaseConfigured) await signOut(auth);
    setUser(null);
  };

  const saveSettings = () => {
    if (organiserEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organiserEmail)) {
      setError('Enter a valid organiser email address or leave it blank.');
      return;
    }
    const settings = {
      eventDate: eventDateSetting,
      registrationDeadline: registrationDeadlineSetting,
      organiserEmail,
    };
    localStorage.setItem('eventSettings', JSON.stringify(settings));
    setError('');
  };

  const toggleAttendance = async (record) => {
    setError('');
    setAttendanceLoadingId(record.id);
    try {
      const token = await user.getIdToken();
      const result = await apiRequest(
        `/api/registrations/${encodeURIComponent(record.id)}/attendance`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ attended: !record.attended }),
        },
        token,
      );
      setRegistrations((previous) => previous.map((item) =>
        item.id === result.registration.id ? result.registration : item));
    } catch (attendanceError) {
      setError(attendanceError.message);
    } finally {
      setAttendanceLoadingId(null);
    }
  };

  const exportCsv = () => {
    const headers = ['Registration ID', 'Team Name', 'Leader Name', 'Leader Email', 'Mobile', 'Organisation', 'City', 'Course', 'Members', 'Registration Date', 'Discount Eligible', 'Attended'];
    const rows = registrations.map((item) => [
      item.id, item.teamName, item.leaderName, item.leaderEmail, item.mobile, item.organisation, item.city, item.course,
      item.members?.map((member) => `${member.name} (${member.age})`).join('; '), item.registrationDate,
      item.discountEligible ? 'Yes' : 'No', item.attended ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = 'hackathon-registrations.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!firebaseConfigured || !user) {
    return (
      <section className="section admin-login">
        <div className="login-card">
          <div className="login-icon"><LogIn /></div>
          <span>Organiser area</span>
          <h1>Secure dashboard login</h1>
          {!firebaseConfigured && <div className="setup-note">Firebase authentication is not connected. This login is disabled until environment variables are configured in .env.local.</div>}
          {error && <div className="form-alert error">{error}</div>}
          <form onSubmit={login}>
            <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!firebaseConfigured} /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={!firebaseConfigured} /></label>
            <button className="button primary" type="submit" disabled={!firebaseConfigured}>Log in securely</button>
          </form>
          <p>Admin passwords are never stored in website code. Create organisers in Firebase Authentication.</p>
        </div>
      </section>
    );
  }

  const filtered = registrations.filter((item) =>
    `${item.teamName} ${item.leaderName} ${item.id} ${item.members?.map((member) => member.name).join(' ')}`
      .toLowerCase().includes(search.toLowerCase()));
  const attendedCount = registrations.filter((item) => item.attended).length;
  return (
    <section className="section admin-dashboard">
      <div className="dashboard-head">
        <div><span>Organiser dashboard</span><h1>Event overview</h1></div>
        <button className="button ghost" onClick={logout}><LogOut size={17} /> Log out</button>
      </div>
      {error && <div className="form-alert error" role="alert">{error}</div>}
      <div className="stat-grid">
        <article><Users /><span>Total registrations</span><strong>{registrations.length}</strong></article>
        <article><Check /><span>Attendees marked</span><strong>{attendedCount}</strong></article>
        <article><Trophy /><span>Teams remaining</span><strong>{Math.max(0, registrations.length - attendedCount)}</strong></article>
        <article><Database /><span>Feedback responses</span><strong>{feedback.length}</strong></article>
      </div>
      <div className="admin-tools">
        <label className="search-box"><Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team, member or ID" /></label>
        <button className="button primary" onClick={exportCsv}>Export CSV</button>
      </div>
      <div className="settings-grid">
        <label>Confirmed base registration fee<input type="number" value={baseRegistrationFee} disabled /></label>
        <label>Confirmed event date<input type="date" value={eventDateSetting} onChange={(e) => setEventDateSetting(e.target.value)} /></label>
        <label>Registration deadline<input type="date" value={registrationDeadlineSetting} onChange={(e) => setRegistrationDeadlineSetting(e.target.value)} /></label>
        <label>Organiser contact email<input type="email" value={organiserEmail} onChange={(e) => setOrganiserEmail(e.target.value)} placeholder="Leave blank until configured" /></label>
        <button className="button dark" onClick={saveSettings}>Save settings</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Team</th><th>Leader</th><th>Course</th><th>Date</th><th>Discount</th><th>Members</th><th>Attendance</th></tr></thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td><td>{item.teamName}</td><td>{item.leaderName}<small>{item.leaderEmail}</small></td><td>{item.course}</td>
                <td>{new Date(item.registrationDate).toLocaleDateString()}</td><td>{item.discountEligible ? '10% eligible' : 'No discount'}</td>
                <td>{item.members?.map((member) => <small key={member.name}>{member.name} - {member.age} yrs</small>)}</td>
                <td><button
                  className={item.attended ? 'attendance on' : 'attendance'}
                  onClick={() => toggleAttendance(item)}
                  disabled={attendanceLoadingId === item.id}
                >{attendanceLoadingId === item.id ? 'Saving...' : item.attended ? 'Attended' : 'Mark attended'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-state">No matching registrations.</div>}
      </div>
      <div className="feedback-admin">
        <h2>Feedback responses</h2>
        {feedback.length === 0 ? <p>No feedback submitted yet.</p> : feedback.map((item, index) => (
          <article key={index}><strong>{item.rating}/5 rating</strong><p>{item.comments || 'No additional comments.'}</p><small>{item.participateAgain === 'Yes' ? 'Would participate again' : 'Response recorded'}</small></article>
        ))}
      </div>
    </section>
  );
}

function Home() {
  return (
    <SiteShell>
      <Hero />
      <HomeNavigation />
    </SiteShell>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/event-details" element={<SiteShell><EventDetails /><DiscountSection /></SiteShell>} />
      <Route path="/register" element={<SiteShell><Registration /></SiteShell>} />
      <Route path="/documents" element={<SiteShell><DocumentUpload /></SiteShell>} />
      <Route path="/location" element={<SiteShell><LocationSection /></SiteShell>} />
      <Route path="/feedback" element={<SiteShell><Feedback /></SiteShell>} />
      <Route path="/faq" element={<SiteShell><FAQPage /></SiteShell>} />
      <Route path="/contact" element={<SiteShell><ContactPage /></SiteShell>} />
      <Route path="/courses" element={<SiteShell><Courses /></SiteShell>} />
      <Route path="/courses/:id" element={<SiteShell><CourseDetail /></SiteShell>} />
      <Route path="/stations" element={<SiteShell><Stations /></SiteShell>} />
      <Route path="/stations/:id" element={<SiteShell><StationDetail /></SiteShell>} />
      <Route path="/admin" element={<SiteShell><Admin /></SiteShell>} />
    </Routes>
  );
}

function App() {
  return (
    <HashRouter>
      <>
        <AppRoutes />
        <FloatingChatbot />
      </>
    </HashRouter>
  );
}

export default App;
