"""Starting values from the Rating algorithm spec.

Every number here is a first guess. The learning step (learning.py) is meant
to replace the signal adjustments and source reliabilities with fitted values.
"""

# Location ramps: (great, bad). Full marks at or better than great, zero at bad.
COMMUTE_RAMP = (8.0, 40.0)        # door-to-class minutes
GROCERY_RAMP = (5.0, 25.0)        # walk minutes to nearest full grocery store
FOOD_PLACES_FULL = 20             # food places within 800 m for full marks
SOCIAL_PLACES_FULL = 30           # places within 1 km where the log curve tops out
JANUARY_WALK_FACTOR = 1.3

FOOD_GROCERY_SHARE = 0.6
FOOD_PLACES_SHARE = 0.4

# Inside checklist item weights (ratings are 1 to 5).
CHECKLIST_WEIGHTS = {
    "heat": 3, "mould": 3, "pests": 3,
    "landlord_response": 2, "deposit_returned": 2,
    "noise": 1, "water_pressure": 1, "outlets": 1, "appliances": 1,
}
REVIEW_HALF_LIFE_YEARS = 2.0
PRIOR_STRENGTH_K = 3.0             # k: how many fresh reviews equal the prediction

# Prediction adjustments: signal -> (per unit, cap). Caps are signed like the step.
SIGNAL_ADJUSTMENTS = {
    "ltb_cases_5y": (-1.0, -2.0),
    "unlicensed": (-0.5, -0.5),
    "relisted_3_in_2y": (-0.5, -0.5),
    "property_standards_orders_3y": (-0.5, -1.0),
    "public_posts_net_negative": (-0.5, -1.0),   # 1 = mildly, 2 = strongly negative
    "landlord_other_houses_good": (0.5, 0.5),
    "recent_renovation_permit": (0.5, 0.5),
}

# Value
VALUE_SLOPE = 25.0
VALUE_FULL_CONFIDENCE_COMPARABLES = 200

# Evidence and confidence
SOURCE_RELIABILITY = {
    "verified_review": 1.0,
    "ltb_decision": 0.9,
    "city_records": 0.9,
    "past_listing": 0.5,
    "google_reviews": 0.4,
    "reddit": 0.3,
    "facebook": 0.3,
    "viewing_note": 0.3,
    "neighbour_note": 0.3,
}
SPECIFICITY = {"address": 1.0, "landlord": 0.6, "street": 0.4, "neighbourhood": 0.15}
EVIDENCE_HALF_LIFE_YEARS = 2.0
CONFIDENCE_SCALE = 3.0             # the 3 in 1 - e^(-E/3)
MAX_DISAGREEMENT_CUT = 0.5
MAP_CONFIDENCE_COMPLETE = 0.9
MAP_CONFIDENCE_ESTIMATED = 0.5
HIGH = 0.75
MEDIUM = 0.45
LOW_RANGE_FACTOR = 3.0

# Ranking
SCORES = ("commute", "food", "social", "inside", "value")
DEFAULT_SLIDER = 3

# Research loop
MAX_ROUNDS = 3
MAX_SEARCHES = 40
MIN_NEW_EVIDENCE = 0.3
TARGETS_PER_ROUND = 2
LANDLORD_NAME_MATCH = 0.9

# Prices
PRICE_CURRENT_DAYS = 7
PRICE_MAY_BE_RENTED_DAYS = 14
PRICE_NEVER_CURRENT_DAYS = 30
# Used only when no tenant has reported utilities anywhere nearby. A placeholder,
# so "utilities extra" never makes a house look cheaper than one that includes them.
FALLBACK_UTILITIES_PER_ROOM = 100.0

# Learning
MIN_PAIRS_FOR_REFIT = 50
RELIABILITY_BLEND_OLD = 0.8
CALIBRATION_TOLERANCE = 1.5
CALIBRATION_TARGET = 0.8
