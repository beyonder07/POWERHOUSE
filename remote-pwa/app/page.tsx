'use client';

import Link from 'next/link';
import { BrandLogo, ThemeToggle, useThemeState } from '../components/chrome';

const TRAINERS = [
  { name: 'Arjun Mehta', role: 'Strength Coach', tags: ['Strength', 'Technique', 'Progression'], years: '8+ yrs' },
  { name: 'Neha Sharma', role: 'Fat Loss Specialist', tags: ['Fat loss', 'Conditioning', 'Nutrition basics'], years: '6+ yrs' },
  { name: 'Rohan Verma', role: 'Mobility and Rehab', tags: ['Mobility', 'Injury prevention', 'Recovery'], years: '7+ yrs' }
];

const PLANS = [
  {
    name: 'Starter',
    price: 'Rs. 999/mo',
    blurb: 'Best for beginners',
    items: ['Gym access', 'Structured starter program', 'Accountability check-ins']
  },
  {
    name: 'Standard',
    price: 'Rs. 1499/mo',
    blurb: 'Most popular',
    highlight: true,
    items: ['Everything in Starter', 'Trainer support', 'Progress check-ins']
  },
  {
    name: 'Transformation',
    price: 'Rs. 2499/mo',
    blurb: 'Results-driven',
    items: ['Everything in Standard', 'Goal-based program block', 'Priority coaching slots']
  }
];

export default function PowerHouseLandingPage() {
  const { theme, toggleTheme } = useThemeState();

  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <BrandLogo />
            <div className="landing-brand-text">
              <strong>PowerHouse Gym</strong>
              <span>Strength. Discipline. Results.</span>
            </div>
          </div>

          <nav className="landing-links" aria-label="Primary">
            <a href="#experience">Experience</a>
            <a href="#trainers">Trainers</a>
            <a href="#plans">Plans</a>
            <a href="#testimonials">Results</a>
          </nav>

          <div className="landing-actions">
            <ThemeToggle theme={theme} onToggle={toggleTheme} compact />
            <Link className="ghost-button" href="/login">Login</Link>
            <Link className="landing-primary" href="/signup/client">Join Now</Link>
          </div>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <p className="eyebrow">PowerHouse Gym</p>
          <h1>Build strength. Build discipline.</h1>
          <p className="landing-lead">
            Join a premium training environment where your workouts stay structured, your progress stays visible, and your consistency becomes unstoppable.
          </p>
          <div className="landing-cta">
            <Link className="landing-primary" href="/signup/client">Start as a Member</Link>
            <Link className="landing-secondary" href="/signup/trainer">Apply as Trainer</Link>
            <Link className="landing-secondary" href="/login">Already a member?</Link>
          </div>
          <p className="landing-trust">
            No long-term lock-in. Beginner friendly. Coach-led training.
          </p>
          <div className="landing-bullets">
            <div className="landing-bullet">
              <strong>Structured programs</strong>
              <span>Progressive plans that remove guesswork.</span>
            </div>
            <div className="landing-bullet">
              <strong>Daily accountability</strong>
              <span>Consistency that turns effort into results.</span>
            </div>
            <div className="landing-bullet">
              <strong>Professional trainers</strong>
              <span>Form, confidence, and measurable progression.</span>
            </div>
          </div>
        </div>

        <div className="landing-hero-visual" aria-hidden="true">
          <div className="hero-card">
            <div className="landing-hero-logo">
              <BrandLogo />
            </div>
            <p className="hero-card-title">Train smart</p>
            <p className="hero-card-sub">Stay accountable. Stay consistent.</p>
            <div className="hero-metrics">
              <div>
                <strong>Programs</strong>
                <span>Strength, fat loss, conditioning</span>
              </div>
              <div>
                <strong>Support</strong>
                <span>Coach guidance and visible progress tracking</span>
              </div>
            </div>
          </div>
          <div className="hero-glow" />
        </div>
      </section>

      <section id="experience" className="landing-section">
        <div className="landing-section-head">
          <p className="eyebrow">Gym Experience</p>
          <h2>This is not just a gym. It is a system of consistency.</h2>
          <p className="subcopy">
            Most people do not fail because they are weak. They fail because training has no structure. PowerHouse is built for discipline: clear programs, coach guidance, and daily accountability.
          </p>
        </div>
        <div className="landing-grid four">
          <article className="landing-card">
            <strong>Personalized workout plans</strong>
            <p className="subcopy">Train with a plan that fits your goal and level.</p>
          </article>
          <article className="landing-card">
            <strong>Structured programs</strong>
            <p className="subcopy">Strength, fat loss, and conditioning with real progression.</p>
          </article>
          <article className="landing-card">
            <strong>Professional trainers</strong>
            <p className="subcopy">Coaching that fixes form, prevents injury, and builds confidence.</p>
          </article>
          <article className="landing-card">
            <strong>Accountability culture</strong>
            <p className="subcopy">Consistency builds results. We help you stay on schedule.</p>
          </article>
        </div>
      </section>

      <section className="landing-section subtle">
        <div className="landing-section-head">
          <p className="eyebrow">Accountability</p>
          <h2>Discipline that you can feel every day.</h2>
          <p className="subcopy">
            Your attendance and progress stay visible so your routine stays real. When showing up becomes automatic, results follow.
          </p>
        </div>
        <div className="landing-grid three">
          <article className="landing-card">
            <strong>Track attendance daily</strong>
            <p className="subcopy">Build a streak. Build a habit.</p>
          </article>
          <article className="landing-card">
            <strong>Monitor progress</strong>
            <p className="subcopy">See your effort turn into measurable improvement.</p>
          </article>
          <article className="landing-card">
            <strong>Never miss your schedule</strong>
            <p className="subcopy">Stay consistent with structured programs and coaching.</p>
          </article>
        </div>
      </section>

      <section id="trainers" className="landing-section">
        <div className="landing-section-head">
          <p className="eyebrow">Trainers</p>
          <h2>Guided by professionals. Built for results.</h2>
          <p className="subcopy">Your coaches do not just motivate you. They correct form, keep training progressing, and make sure your effort counts.</p>
        </div>
        <div className="landing-grid three">
          {TRAINERS.map((trainer) => (
            <article key={trainer.name} className="landing-card trainer-card">
              <div className="trainer-avatar" aria-hidden="true">{trainer.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div>
              <div className="trainer-meta">
                <strong>{trainer.name}</strong>
                <span className="subcopy">{trainer.role} - {trainer.years}</span>
              </div>
              <div className="trainer-tags">
                {trainer.tags.map((tag) => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
              <p className="subcopy">Technique first, intensity second. Progress is earned and protected.</p>
            </article>
          ))}
        </div>
      </section>

      <section id="plans" className="landing-section">
        <div className="landing-section-head">
          <p className="eyebrow">Membership</p>
          <h2>Simple plans. Clear outcomes.</h2>
          <p className="subcopy">Pick a plan that matches your goal. Upgrade anytime as your discipline grows.</p>
        </div>

        <div className="landing-grid three">
          {PLANS.map((plan) => (
            <article key={plan.name} className={`landing-card plan-card ${plan.highlight ? 'highlight' : ''}`}>
              <div className="plan-head">
                <div>
                  <strong>{plan.name}</strong>
                  <span className="subcopy">{plan.blurb}</span>
                </div>
                <div className="plan-price" aria-label={`${plan.name} price`}>
                  <strong>{plan.price}</strong>
                </div>
              </div>
              <ul className="check-list">
                {plan.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <Link className={plan.highlight ? 'landing-primary' : 'landing-secondary'} href="/signup/client">Choose {plan.name}</Link>
            </article>
          ))}
        </div>

        <div className="landing-note">
          <p className="subcopy">
            Prefer to talk first? <Link className="inline-link" href="/signup/client">Send a quick join request</Link> and we will guide you.
          </p>
        </div>
      </section>

      <section id="testimonials" className="landing-section subtle">
        <div className="landing-section-head">
          <p className="eyebrow">Trust</p>
          <h2>Trusted by local members who train with discipline.</h2>
          <p className="subcopy">Real routines. Real consistency. Real transformation.</p>
        </div>
        <div className="landing-grid three">
          <article className="landing-card">
            <strong>"I finally stayed consistent."</strong>
            <p className="subcopy">"The structure makes it impossible to drift. I show up, follow the plan, and results come."</p>
            <span className="subcopy">- Member, 3 months</span>
          </article>
          <article className="landing-card">
            <strong>"Coaching changed everything."</strong>
            <p className="subcopy">"My form improved fast. Training feels professional, not random."</p>
            <span className="subcopy">- Member, Strength program</span>
          </article>
          <article className="landing-card">
            <strong>"Accountability works."</strong>
            <p className="subcopy">"Tracking my routine made me stop skipping. The discipline carries over into life."</p>
            <span className="subcopy">- Member, Fat loss program</span>
          </article>
        </div>
      </section>

      <section id="final-cta" className="landing-final">
        <div className="landing-final-inner">
          <p className="eyebrow">Start Today</p>
          <h2>Take the first step with PowerHouse Gym.</h2>
          <p className="subcopy">
            Discipline wins. Join PowerHouse and train with structure, coaching, and accountability every day.
          </p>
          <div className="landing-cta">
            <Link className="landing-primary" href="/signup/client">Request Membership</Link>
            <Link className="landing-secondary" href="/signup/trainer">Trainer Application</Link>
            <Link className="landing-secondary" href="/forgot-password">Forgot Password</Link>
          </div>
          <p className="landing-trust">Visit us today. Try a session. Choose your plan.</p>
        </div>
      </section>

      <footer className="landing-footer">
        <span className="subcopy">Copyright {new Date().getFullYear()} PowerHouse Gym</span>
        <span className="subcopy">Built for discipline, structure, and results.</span>
      </footer>
    </main>
  );
}
