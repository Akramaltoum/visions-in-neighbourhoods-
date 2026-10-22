'use strict';

const neighbourhoods = ['Westdale', 'Ainslie Wood', 'Main St W', 'Kirkendall', 'Strathcona'];

// Sample houses so the site isn't empty before real listings arrive. Every one is
// labelled "Sample" on the site. They have no number on the street on purpose, so
// none can be mistaken for a real house. Turn off with SEED_SAMPLES=false.
const samples = [
  { street: 'Emerson St', area: 'Westdale', type: '5-bed semi', beds: 5, rent: 725, util: false, walk: 8, grocery: 7, food: 18, social: 20, parking: 2 },
  { street: 'Main St W', area: 'Main St W', type: '4-bed above a shop', beds: 4, rent: 650, util: true, walk: 14, grocery: 3, food: 30, social: 40, parking: 0 },
  { street: 'Dalewood Ave', area: 'Ainslie Wood', type: '6-bed detached', beds: 6, rent: 590, util: false, walk: 22, grocery: 12, food: 6, social: 5, parking: 4 },
  { street: 'Sterling St', area: 'Westdale', type: '3-bed upper unit', beds: 3, rent: 780, util: true, walk: 5, grocery: 9, food: 14, social: 12, parking: 0 },
  { street: 'Haddon Ave S', area: 'Ainslie Wood', type: '5-bed bungalow', beds: 5, rent: 615, util: false, walk: 16, grocery: 10, food: 9, social: 8, parking: 3 },
  { street: 'Leland St', area: 'Ainslie Wood', type: '4-bed semi', beds: 4, rent: 640, util: false, walk: 12, grocery: 8, food: 12, social: 10, parking: 1 },
  { street: 'Locke St S', area: 'Kirkendall', type: '3-bed townhouse', beds: 3, rent: 700, util: false, walk: 30, bus: 15, gap: 10, grocery: 6, food: 25, social: 28, parking: 1 },
  { street: 'Strathcona Ave N', area: 'Strathcona', type: '4-bed house', beds: 4, rent: 610, util: false, walk: 35, bus: 18, gap: 12, grocery: 9, food: 10, social: 9, parking: 2 },
];

module.exports = { neighbourhoods, samples };
