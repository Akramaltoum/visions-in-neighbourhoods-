'use strict';

// Profile roles from the spec's "Listings, accounts and opinions" section.
const ROLES = [
  { id: 'looking', label: 'Student looking for a place' },
  { id: 'tenant', label: 'Current tenant' },
  { id: 'former', label: 'Past tenant' },
  { id: 'viewed', label: 'Viewed a house' },
  { id: 'neighbour', label: 'Neighbour or local resident' },
  { id: 'parent', label: 'Parent or guardian' },
  { id: 'landlord', label: 'Landlord' },
  { id: 'manager', label: 'Property manager' },
  { id: 'buyer', label: 'Buyer or investor' },
];
const ROLE_IDS = new Set(ROLES.map((r) => r.id));
// Who can post a listing of their own (links to other sites are open to everyone).
const LISTING_ROLES = new Set(['landlord', 'manager']);
// "How do you know this house?" on an opinion. Landlords reply instead of rating.
const OPINION_ROLES = new Set(['tenant', 'former', 'viewed', 'neighbour', 'parent', 'looking']);

// Inside checklist, rated 1 to 5. Same items and weights as rating_engine/config.py.
const CHECKLIST = [
  { id: 'heat', label: 'Heat in winter' },
  { id: 'mould', label: 'No mould' },
  { id: 'pests', label: 'No pests' },
  { id: 'landlord_response', label: 'Landlord response time' },
  { id: 'deposit_returned', label: 'Deposit returned fairly' },
  { id: 'noise', label: 'Quiet' },
  { id: 'water_pressure', label: 'Water pressure' },
  { id: 'outlets', label: 'Enough outlets' },
  { id: 'appliances', label: 'Appliances work' },
];

const SCORES = [
  { id: 'commute', label: 'Commute' },
  { id: 'food', label: 'Food' },
  { id: 'social', label: 'Social' },
  { id: 'inside', label: 'Inside' },
  { id: 'value', label: 'Value' },
];

module.exports = { ROLES, ROLE_IDS, LISTING_ROLES, OPINION_ROLES, CHECKLIST, SCORES };
