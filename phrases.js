// Things the announcer shouts. Add your own! Each list is shuffled so phrases
// don't repeat until the whole list has been used.

export const PHRASES = {
  start: ["Tip off!", "Let's go!", "It's game time!", "Lock in!"],

  // Any basket.
  make: [
    "Boomshakalaka!",
    "Is it the shoes?!",
    "Razzle dazzle!",
    "Count it!",
    "Kaboom!",
    "He's got it!",
    "Let him cook!",
    "He's cooking!",
    "Chef's kiss!",
    "Sheesh!",
    "Bucket!",
    "Too easy!",
    "Cash!",
    "Built different!",
    "Main character energy!",
    "Big W!",
    "No cap!",
    "Understood the assignment!",
    "Ice in his veins!",
    "Absolute cinema!",
    "Easy money!",
    "Different gravy!",
    "That's bussin'!",
  ],

  // Nothing but net.
  swish: ["Swish!", "Nothing but net!", "Wet!", "Butter!", "Silky smooth!", "Splash!"],

  // Off the backboard and in.
  bank: ["Off the glass!", "Glass!", "Kiss off the glass!", "The bank is open!", "We take those!"],

  // Made from behind the 3-point line.
  three: [
    "From downtown!",
    "From way downtown!",
    "He's dialing long distance!",
    "Logo range!",
    "From the parking lot!",
    "Deep in the bag!",
    "Bang!",
  ],

  // Two in a row.
  heatingUp: ["He's heating up!", "Somebody's warming up!", "He's getting cooking!"],

  // Three in a row: he's on fire until he misses.
  onFire: ["He's on fire!", "Too hot to handle!", "Call the fire department!"],
  stillOnFire: ["He's still on fire!", "Unstoppable!", "Can't be stopped!", "Somebody stop him!"],
  fireOut: ["And the fire's out.", "He's cooled off.", "Fire's out!"],

  // Scored after the buzzer went.
  buzzer: ["At the buzzer!", "Just under the wire!", "Buzzer beater!"],

  // Any miss.
  miss: [
    "Brick!",
    "Clank!",
    "Not even close.",
    "Rejected by the rim!",
    "Bro thought he did something.",
    "Not the vibe.",
    "Rim said nope.",
    "The rim is undefeated.",
    "That's a no from me.",
    "Skill issue!",
    "Who let him cook?",
  ],

  // Didn't touch the rim or the backboard.
  airball: ["Air ball!", "Didn't even hit the rim!", "Lost in the clouds!", "Air ball. Touch grass."],

  // Three misses in a row.
  cold: ["He can't buy a bucket!", "He's cooked.", "Ice cold!", "Down bad!"],

  // End of game, by score.
  overLow: ["Warm-up round.", "Shake it off!", "Practice makes perfect!"],
  overMid: ["Not bad, rookie!", "Solid run!", "Getting there!"],
  overHigh: ["All-star performance!", "That's a highlight reel!", "He's cooking now!"],
  overGoat: ["GOAT behaviour!", "Hall of fame stuff!", "Absolute legend!"],
  newBest: ["New personal best!", "Record breaker!"],
};

const bags = {};

export function pickPhrase(category) {
  let bag = bags[category];
  if (!bag || bag.length === 0) {
    bag = bags[category] = [...PHRASES[category]];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}
