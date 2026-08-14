/* @ds-bundle: {"format":4,"namespace":"FinsightDesignSystem_dda60d","components":[{"name":"BadgePill","sourcePath":"components/badges/BadgePill.jsx"},{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"FeatureCard","sourcePath":"components/cards/FeatureCard.jsx"},{"name":"ProductUICard","sourcePath":"components/cards/ProductUICard.jsx"},{"name":"CTABand","sourcePath":"components/footer/CTABand.jsx"},{"name":"Footer","sourcePath":"components/footer/Footer.jsx"},{"name":"FooterLink","sourcePath":"components/footer/FooterLink.jsx"},{"name":"SearchInputPill","sourcePath":"components/forms/SearchInputPill.jsx"},{"name":"TextInput","sourcePath":"components/forms/TextInput.jsx"},{"name":"HeroBand","sourcePath":"components/heroes/HeroBand.jsx"},{"name":"TopNav","sourcePath":"components/navigation/TopNav.jsx"},{"name":"PricingTierCard","sourcePath":"components/pricing/PricingTierCard.jsx"},{"name":"AssetIcon","sourcePath":"components/trading/AssetIcon.jsx"},{"name":"AssetRow","sourcePath":"components/trading/AssetRow.jsx"},{"name":"PriceCell","sourcePath":"components/trading/PriceCell.jsx"}]} */

(() => {

const __ds_ns = (window.FinsightDesignSystem_dda60d = window.FinsightDesignSystem_dda60d || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/badges/BadgePill.jsx
try { (() => {
function BadgePill({
  children = 'INSTITUTIONAL'
}) {
  return React.createElement('span', {
    style: {
      display: 'inline-flex',
      padding: '6px 14px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--color-surface-strong)',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-caption-strong-size)',
      fontWeight: 'var(--text-caption-strong-weight)',
      letterSpacing: '0.5px',
      textTransform: 'uppercase'
    }
  }, children);
}
Object.assign(__ds_scope, { BadgePill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/badges/BadgePill.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Button.jsx
try { (() => {
const VARIANTS = {
  'primary': {
    background: 'var(--color-primary)',
    color: 'var(--color-on-primary)',
    border: 'none'
  },
  'primary-active': {
    background: 'var(--color-primary-active)',
    color: 'var(--color-on-primary)',
    border: 'none'
  },
  'primary-disabled': {
    background: 'var(--color-primary-disabled)',
    color: 'var(--color-on-primary)',
    border: 'none',
    cursor: 'not-allowed'
  },
  'secondary-light': {
    background: 'var(--color-surface-strong)',
    color: 'var(--color-ink)',
    border: 'none'
  },
  'secondary-dark': {
    background: 'var(--color-surface-dark-elevated)',
    color: 'var(--color-on-dark)',
    border: 'none'
  },
  'outline-on-dark': {
    background: 'transparent',
    color: 'var(--color-on-dark)',
    border: '1px solid #ffffff'
  },
  'tertiary-text': {
    background: 'transparent',
    color: 'var(--color-primary)',
    border: 'none',
    padding: '0'
  }
};
function Button({
  variant = 'primary',
  size = 'default',
  children,
  disabled,
  onClick
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const isPill = variant !== 'tertiary-text';
  const style = {
    fontFamily: 'var(--font-body)',
    fontSize: 'var(--text-button-size)',
    fontWeight: 'var(--text-button-weight)',
    lineHeight: 'var(--text-button-lh)',
    borderRadius: isPill ? 'var(--radius-pill)' : 0,
    height: isPill ? size === 'large' ? '56px' : '44px' : 'auto',
    padding: isPill ? size === 'large' ? '16px 32px' : '12px 20px' : 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled || variant === 'primary-disabled' ? 'not-allowed' : 'pointer',
    ...v
  };
  return React.createElement('button', {
    style,
    disabled: disabled || variant === 'primary-disabled',
    onClick
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/cards/FeatureCard.jsx
try { (() => {
function FeatureCard({
  title = 'Custody',
  body = 'Your assets, secured by institutional-grade custody.',
  icon
}) {
  return React.createElement('div', {
    style: {
      background: 'var(--color-canvas)',
      borderRadius: 'var(--radius-xl)',
      padding: 'var(--space-xl)',
      fontFamily: 'var(--font-body)',
      border: '1px solid var(--color-hairline)',
      width: '280px',
      boxSizing: 'border-box'
    }
  }, [icon && React.createElement('div', {
    key: 'i',
    style: {
      width: '32px',
      height: '32px',
      borderRadius: 'var(--radius-full)',
      background: 'var(--color-surface-strong)',
      marginBottom: '16px'
    }
  }), React.createElement('div', {
    key: 't',
    style: {
      fontSize: 'var(--text-title-md-size)',
      fontWeight: 'var(--text-title-md-weight)',
      marginBottom: '8px',
      color: 'var(--color-ink)'
    }
  }, title), React.createElement('div', {
    key: 'b',
    style: {
      fontSize: 'var(--text-body-md-size)',
      color: 'var(--color-body)',
      lineHeight: 'var(--text-body-md-lh)'
    }
  }, body)]);
}
Object.assign(__ds_scope, { FeatureCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/FeatureCard.jsx", error: String((e && e.message) || e) }); }

// components/cards/ProductUICard.jsx
try { (() => {
function ProductUICard({
  theme = 'dark',
  title = 'Portfolio',
  rows = [['BTC', '$64,281.40', '+2.14%'], ['ETH', '$3,412.90', '-0.82%']],
  style
}) {
  const dark = theme === 'dark';
  const cardStyle = {
    background: dark ? 'var(--color-surface-dark-elevated)' : 'var(--color-canvas)',
    color: dark ? 'var(--color-on-dark)' : 'var(--color-ink)',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-xl)',
    fontFamily: 'var(--font-body)',
    border: dark ? 'none' : '1px solid var(--color-hairline)',
    width: '260px',
    boxSizing: 'border-box',
    ...style
  };
  return React.createElement('div', {
    style: cardStyle
  }, [React.createElement('div', {
    key: 't',
    style: {
      fontSize: 'var(--text-title-md-size)',
      fontWeight: 'var(--text-title-md-weight)',
      marginBottom: '16px'
    }
  }, title), ...rows.map(([sym, price, chg]) => React.createElement('div', {
    key: sym,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-number-display-size)',
      marginBottom: '8px'
    }
  }, [React.createElement('span', {
    key: 's',
    style: {
      opacity: 0.7
    }
  }, sym), React.createElement('span', {
    key: 'p'
  }, price), React.createElement('span', {
    key: 'c',
    style: {
      color: chg.startsWith('-') ? 'var(--color-semantic-down)' : 'var(--color-semantic-up)'
    }
  }, chg)]))]);
}
Object.assign(__ds_scope, { ProductUICard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cards/ProductUICard.jsx", error: String((e && e.message) || e) }); }

// components/footer/CTABand.jsx
try { (() => {
function CTABand({
  headline = 'Take control of your money',
  children
}) {
  return React.createElement('div', {
    style: {
      background: 'var(--color-surface-dark)',
      color: 'var(--color-on-dark)',
      padding: 'var(--space-section) 32px',
      textAlign: 'center',
      fontFamily: 'var(--font-body)'
    }
  }, [React.createElement('div', {
    key: 'h',
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--weight-display)',
      fontSize: 'var(--text-display-md-size)',
      letterSpacing: 'var(--text-display-md-ls)',
      marginBottom: '32px'
    }
  }, headline), React.createElement('div', {
    key: 'c',
    style: {
      display: 'flex',
      gap: '12px',
      justifyContent: 'center'
    }
  }, children)]);
}
Object.assign(__ds_scope, { CTABand });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/footer/CTABand.jsx", error: String((e && e.message) || e) }); }

// components/footer/FooterLink.jsx
try { (() => {
function FooterLink({
  children
}) {
  return React.createElement('div', {
    style: {
      color: 'var(--color-body)',
      fontSize: 'var(--text-body-sm-size)',
      marginBottom: '8px',
      cursor: 'pointer'
    }
  }, children);
}
Object.assign(__ds_scope, { FooterLink });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/footer/FooterLink.jsx", error: String((e && e.message) || e) }); }

// components/footer/Footer.jsx
try { (() => {
function Footer({
  columns = [{
    title: 'Products',
    links: ['Buy & sell', 'Wealth', 'Institutions']
  }, {
    title: 'Company',
    links: ['About', 'Careers', 'Press']
  }, {
    title: 'Resources',
    links: ['Learn', 'Blog', 'Support']
  }]
}) {
  return React.createElement('div', {}, [React.createElement('div', {
    key: 'cols',
    style: {
      display: 'flex',
      gap: '48px',
      padding: 'var(--space-section) 32px',
      fontFamily: 'var(--font-body)',
      background: 'var(--color-canvas)'
    }
  }, columns.map(c => React.createElement('div', {
    key: c.title
  }, [React.createElement('div', {
    key: 't',
    style: {
      fontSize: 'var(--text-title-sm-size)',
      fontWeight: 'var(--text-title-sm-weight)',
      color: 'var(--color-ink)',
      marginBottom: '12px'
    }
  }, c.title), ...c.links.map(l => React.createElement(__ds_scope.FooterLink, {
    key: l
  }, l))]))), React.createElement('div', {
    key: 'legal',
    style: {
      padding: '24px 32px',
      fontSize: 'var(--text-caption-size)',
      color: 'var(--color-muted)',
      borderTop: '1px solid var(--color-hairline)'
    }
  }, '© 2026 Finsight. All rights reserved.')]);
}
Object.assign(__ds_scope, { Footer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/footer/Footer.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchInputPill.jsx
try { (() => {
function SearchInputPill({
  placeholder = 'Search assets'
}) {
  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      height: '44px',
      padding: '12px 20px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--color-surface-strong)',
      width: '240px',
      boxSizing: 'border-box'
    }
  }, [React.createElement('span', {
    key: 'i',
    style: {
      opacity: 0.5
    }
  }, '⌕'), React.createElement('span', {
    key: 't',
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-body-sm-size)',
      color: 'var(--color-muted)'
    }
  }, placeholder)]);
}
Object.assign(__ds_scope, { SearchInputPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchInputPill.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextInput.jsx
try { (() => {
function TextInput({
  placeholder = 'Email address',
  value,
  onChange,
  focused = false
}) {
  return React.createElement('input', {
    placeholder,
    value,
    onChange,
    style: {
      height: '48px',
      padding: '14px 16px',
      borderRadius: 'var(--radius-md)',
      boxSizing: 'border-box',
      border: focused ? '2px solid var(--color-primary)' : '1px solid var(--color-hairline)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-body-md-size)',
      color: 'var(--color-ink)',
      width: '260px',
      outline: 'none'
    }
  });
}
Object.assign(__ds_scope, { TextInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextInput.jsx", error: String((e && e.message) || e) }); }

// components/heroes/HeroBand.jsx
try { (() => {
function HeroBand({
  theme = 'dark',
  eyebrow,
  headline = 'Own your money',
  subhead = 'A regulated platform for buying, selling, and holding crypto assets.',
  children
}) {
  const dark = theme === 'dark';
  const style = {
    background: dark ? 'var(--color-surface-dark)' : 'var(--color-canvas)',
    color: dark ? 'var(--color-on-dark)' : 'var(--color-ink)',
    padding: 'var(--space-section) 32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '48px',
    fontFamily: 'var(--font-body)',
    flexWrap: 'wrap'
  };
  return React.createElement('div', {
    style
  }, [React.createElement('div', {
    key: 'l',
    style: {
      maxWidth: '560px'
    }
  }, [eyebrow && React.createElement('div', {
    key: 'e',
    style: {
      fontSize: 'var(--text-caption-strong-size)',
      fontWeight: 'var(--text-caption-strong-weight)',
      letterSpacing: '0.5px',
      textTransform: 'uppercase',
      color: dark ? 'var(--color-on-dark-soft)' : 'var(--color-muted)',
      marginBottom: '16px'
    }
  }, eyebrow), React.createElement('div', {
    key: 'h',
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--weight-display)',
      fontSize: 'var(--text-display-md-size)',
      lineHeight: 'var(--text-display-md-lh)',
      letterSpacing: 'var(--text-display-md-ls)',
      marginBottom: '20px'
    }
  }, headline), React.createElement('div', {
    key: 's',
    style: {
      fontSize: 'var(--text-body-md-size)',
      color: dark ? 'var(--color-on-dark-soft)' : 'var(--color-body)',
      marginBottom: '32px',
      maxWidth: '440px'
    }
  }, subhead), React.createElement('div', {
    key: 'c',
    style: {
      display: 'flex',
      gap: '12px'
    }
  }, [React.createElement('button', {
    key: 'b1',
    style: {
      background: 'var(--color-primary)',
      color: '#fff',
      border: 'none',
      borderRadius: 'var(--radius-pill)',
      padding: '16px 32px',
      fontSize: 'var(--text-button-size)',
      fontWeight: 'var(--text-button-weight)',
      cursor: 'pointer'
    }
  }, 'Get started'), React.createElement('button', {
    key: 'b2',
    style: {
      background: 'transparent',
      color: dark ? '#fff' : 'var(--color-ink)',
      border: dark ? '1px solid #fff' : '1px solid var(--color-hairline)',
      borderRadius: 'var(--radius-pill)',
      padding: '16px 32px',
      fontSize: 'var(--text-button-size)',
      fontWeight: 'var(--text-button-weight)',
      cursor: 'pointer'
    }
  }, 'Learn more')])]), React.createElement('div', {
    key: 'r',
    style: {
      position: 'relative',
      width: '320px',
      height: '220px'
    }
  }, children)]);
}
Object.assign(__ds_scope, { HeroBand });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/heroes/HeroBand.jsx", error: String((e && e.message) || e) }); }

// components/navigation/TopNav.jsx
try { (() => {
function TopNav({
  theme = 'light',
  links = ['Cryptocurrencies', 'Individuals', 'Businesses', 'Institutions', 'Developers', 'Company']
}) {
  const dark = theme === 'dark';
  const style = {
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    background: dark ? 'var(--color-surface-dark)' : 'var(--color-canvas)',
    color: dark ? 'var(--color-on-dark)' : 'var(--color-ink)',
    fontFamily: 'var(--font-body)',
    borderBottom: dark ? 'none' : '1px solid var(--color-hairline)'
  };
  return React.createElement('div', {
    style
  }, [React.createElement('div', {
    key: 'l',
    style: {
      fontWeight: 700,
      fontSize: '18px'
    }
  }, 'Finsight'), React.createElement('div', {
    key: 'm',
    style: {
      display: 'flex',
      gap: '24px',
      fontSize: 'var(--text-nav-link-size)',
      fontWeight: 'var(--text-nav-link-weight)'
    }
  }, links.map(l => React.createElement('span', {
    key: l,
    style: {
      cursor: 'pointer'
    }
  }, l))), React.createElement('div', {
    key: 'r',
    style: {
      display: 'flex',
      gap: '16px',
      alignItems: 'center',
      fontSize: 'var(--text-nav-link-size)'
    }
  }, [React.createElement('span', {
    key: 's'
  }, 'Sign In'), React.createElement('span', {
    key: 'u',
    style: {
      padding: '10px 18px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--color-primary)',
      color: 'var(--color-on-primary)',
      fontWeight: 600
    }
  }, 'Sign Up')])]);
}
Object.assign(__ds_scope, { TopNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/TopNav.jsx", error: String((e && e.message) || e) }); }

// components/pricing/PricingTierCard.jsx
try { (() => {
function PricingTierCard({
  featured = false,
  name = 'Standard',
  price = '$0',
  period = '/mo',
  features = ['Spot trading', 'Standard support', 'Basic API access'],
  cta = 'Get started'
}) {
  const style = {
    background: featured ? 'var(--color-surface-dark)' : 'var(--color-canvas)',
    color: featured ? 'var(--color-on-dark)' : 'var(--color-ink)',
    borderRadius: 'var(--radius-xl)',
    padding: 'var(--space-xl)',
    width: '280px',
    boxSizing: 'border-box',
    border: featured ? 'none' : '1px solid var(--color-hairline)',
    fontFamily: 'var(--font-body)'
  };
  return React.createElement('div', {
    style
  }, [React.createElement('div', {
    key: 'n',
    style: {
      fontSize: 'var(--text-title-sm-size)',
      fontWeight: 'var(--text-title-sm-weight)',
      marginBottom: '12px'
    }
  }, name), React.createElement('div', {
    key: 'p',
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '32px',
      marginBottom: '20px'
    }
  }, [price, React.createElement('span', {
    key: 'pd',
    style: {
      fontSize: '14px',
      opacity: 0.6
    }
  }, period)]), React.createElement('ul', {
    key: 'f',
    style: {
      listStyle: 'none',
      padding: 0,
      margin: '0 0 24px',
      fontSize: 'var(--text-body-sm-size)',
      color: featured ? 'var(--color-on-dark-soft)' : 'var(--color-body)'
    }
  }, features.map(f => React.createElement('li', {
    key: f,
    style: {
      marginBottom: '8px'
    }
  }, '✓  ' + f))), React.createElement('button', {
    key: 'b',
    style: {
      width: '100%',
      background: featured ? 'var(--color-primary)' : 'var(--color-surface-strong)',
      color: featured ? '#fff' : 'var(--color-ink)',
      border: 'none',
      borderRadius: 'var(--radius-pill)',
      height: '44px',
      fontSize: 'var(--text-button-size)',
      fontWeight: 'var(--text-button-weight)',
      cursor: 'pointer'
    }
  }, cta)]);
}
Object.assign(__ds_scope, { PricingTierCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/pricing/PricingTierCard.jsx", error: String((e && e.message) || e) }); }

// components/trading/AssetIcon.jsx
try { (() => {
function AssetIcon({
  label = 'B',
  color = 'var(--color-surface-strong)'
}) {
  return React.createElement('div', {
    style: {
      width: '32px',
      height: '32px',
      borderRadius: 'var(--radius-full)',
      background: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-body)',
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--color-ink)',
      flexShrink: 0
    }
  }, label);
}
Object.assign(__ds_scope, { AssetIcon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trading/AssetIcon.jsx", error: String((e && e.message) || e) }); }

// components/trading/PriceCell.jsx
try { (() => {
function PriceCell({
  value = '+2.14%'
}) {
  const down = value.trim().startsWith('-');
  return React.createElement('span', {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-number-display-size)',
      fontWeight: 'var(--text-number-display-weight)',
      color: down ? 'var(--color-semantic-down)' : 'var(--color-semantic-up)'
    }
  }, value);
}
Object.assign(__ds_scope, { PriceCell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trading/PriceCell.jsx", error: String((e && e.message) || e) }); }

// components/trading/AssetRow.jsx
try { (() => {
function AssetRow({
  icon = 'B',
  name = 'Bitcoin',
  ticker = 'BTC',
  price = '$64,281.40',
  change = '+2.14%'
}) {
  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '16px 0',
      borderBottom: '1px solid var(--color-hairline)',
      fontFamily: 'var(--font-body)'
    }
  }, [React.createElement(__ds_scope.AssetIcon, {
    key: 'i',
    label: icon
  }), React.createElement('div', {
    key: 'n',
    style: {
      flex: 1
    }
  }, [React.createElement('div', {
    key: 'nm',
    style: {
      fontSize: 'var(--text-title-md-size)',
      fontWeight: 'var(--text-title-md-weight)',
      color: 'var(--color-ink)'
    }
  }, name), React.createElement('div', {
    key: 'tk',
    style: {
      fontSize: 'var(--text-caption-size)',
      color: 'var(--color-muted)'
    }
  }, ticker)]), React.createElement('span', {
    key: 'p',
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-number-display-size)',
      color: 'var(--color-ink)',
      width: '110px',
      textAlign: 'right'
    }
  }, price), React.createElement('span', {
    key: 'c',
    style: {
      width: '80px',
      textAlign: 'right'
    }
  }, React.createElement(__ds_scope.PriceCell, {
    value: change
  }))]);
}
Object.assign(__ds_scope, { AssetRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/trading/AssetRow.jsx", error: String((e && e.message) || e) }); }

__ds_ns.BadgePill = __ds_scope.BadgePill;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.FeatureCard = __ds_scope.FeatureCard;

__ds_ns.ProductUICard = __ds_scope.ProductUICard;

__ds_ns.CTABand = __ds_scope.CTABand;

__ds_ns.Footer = __ds_scope.Footer;

__ds_ns.FooterLink = __ds_scope.FooterLink;

__ds_ns.SearchInputPill = __ds_scope.SearchInputPill;

__ds_ns.TextInput = __ds_scope.TextInput;

__ds_ns.HeroBand = __ds_scope.HeroBand;

__ds_ns.TopNav = __ds_scope.TopNav;

__ds_ns.PricingTierCard = __ds_scope.PricingTierCard;

__ds_ns.AssetIcon = __ds_scope.AssetIcon;

__ds_ns.AssetRow = __ds_scope.AssetRow;

__ds_ns.PriceCell = __ds_scope.PriceCell;

})();
