import type { Config } from 'tailwindcss';

/**
 * The theme is the prototype's Style A token set (prototype/tokens.css), one
 * variable at a time. Colors resolve through CSS variables rather than being
 * copied as hex, so app/globals.css stays the single place a token changes —
 * exactly as tokens.css was for the prototype.
 *
 * The five status semantics (success/info/warning/danger/neutral) mean the same
 * thing on every screen. Don't add a sixth, and don't reuse one for decoration.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        card: 'var(--card-bg)',
        border: 'var(--border)',
        primary: {
          DEFAULT: 'var(--primary)',
          soft: 'var(--primary-soft)',
          contrast: 'var(--primary-contrast)',
        },
        text: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
        },
        // ชำระแล้ว / occupied / รอตรวจสอบ / เกินกำหนด / blocked
        success: 'var(--success)',
        info: 'var(--info)',
        warning: 'var(--warning)',
        danger: 'var(--danger)',
        neutral: 'var(--neutral)',
        chrome: {
          DEFAULT: 'var(--chrome-bg)',
          text: 'var(--chrome-text)',
          muted: 'var(--chrome-muted)',
          border: 'var(--chrome-border)',
          'active-bg': 'var(--chrome-active-bg)',
          'active-text': 'var(--chrome-active-text)',
        },
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        btn: 'var(--btn-radius)',
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        heading: ['var(--font-heading)'],
      },
      boxShadow: {
        card: 'var(--card-shadow)',
        drawer: 'var(--drawer-shadow)',
      },
      spacing: {
        // 44px touch target / 52px primary action on the tenant phone screens
        touch: '44px',
        action: '52px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
