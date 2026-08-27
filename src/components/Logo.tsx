/**
 * The app's mark: an engraved quarter rest — a *crotchet*, which the repo is
 * named after. Same glyph as the installed icon (public/icons), drawn in
 * `currentColor` so whatever it sits in decides the colour.
 *
 * The viewBox is trimmed to the glyph's own bounds rather than the icon's square
 * canvas: the rest is tall and narrow, and inside the square it would have to be
 * sized by the padding around it instead of by the height it actually reads at.
 * Set a height on it and the width follows.
 */
import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="46 25 37 78"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M65.6136 27.7727L75.5604 41.2076C75.9429 41.9338 75.9429 43.0231 75.1778 43.3862C72.1173 45.5649 65.9962 52.1008 66.7613 61.1784C67.5265 69.1668 75.5604 77.8813 80.5338 82.6017C81.6815 83.691 80.5338 85.5066 79.0035 85.5066C74.4127 85.1435 67.909 85.1435 64.8485 88.0483C62.1705 90.59 63.3182 94.2211 65.231 97.4891C65.9962 98.9415 64.0833 100.757 62.5531 99.6677C59.4925 97.4891 55.6669 93.858 53.754 88.4114C50.3109 78.9706 54.5192 75.7027 61.4054 74.6134C62.5531 74.2503 63.3182 72.7978 62.5531 72.0716L48.3981 54.6425C47.6329 53.9163 48.0155 52.4639 49.1632 52.1008C51.076 51.0115 54.5192 49.1959 59.11 44.4755C62.9356 40.4814 63.3182 34.3086 62.5531 28.862C62.1705 27.0464 64.4659 26.3202 65.6136 27.7727Z"
      fill="currentColor"
    />
  </svg>
);
