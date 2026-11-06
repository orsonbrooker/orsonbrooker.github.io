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
  swish: ["Swish!", "Nothing but net!", "Wet!", "Butter!", "Silky smooth!", "Splash!", "Cash money!", "Didn't even touch the rim!"],

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
  heatingUp: ["He's heating up!", "Somebody's warming up!", "He's getting cooking!", "Two in a row!", "Stay hot!"],

  // Three in a row: he's on fire until he misses.
  onFire: ["He's on fire!", "Too hot to handle!", "Call the fire department!"],
  stillOnFire: ["He's still on fire!", "Unstoppable!", "Can't be stopped!", "Somebody stop him!"],
  // Six in a row: the flames turn purple.
  purpleFire: ["Purple flames!", "He's on PURPLE fire!", "That's a different kind of fire!", "Fire so hot it turned purple!"],
  stillPurpleFire: ["Still purple!", "The purple reign continues!", "Nobody can cool him down!", "Purple haze!"],
  // Ten in a row: blue-white supernova.
  supernova: ["Supernova!", "He's gone supernova!", "Blue flames!"],
  stillSupernova: ["Still supernova!", "Brighter than the sun!", "Out of this world!"],
  fireOut: ["And the fire's out.", "He's cooled off.", "Fire's out!"],

  // Sudden death: the longer the run, the bigger the call (see RUN_CALLS in game.js).
  run10: ["Ten in a row!", "Double digits!", "He's in the zone!"],
  run15: ["Fifteen straight!", "He just won't miss!", "Is this real life?"],
  run20: ["Twenty in a row!", "Somebody check the hoop!", "This is getting ridiculous!"],
  run25: ["Twenty five!", "He's not human!", "Call the scientists!"],
  run30: ["Thirty straight!", "History in the making!", "Legendary run!"],
  run40: ["Forty in a row!", "Are you watching this?!", "Break the record books!"],
  run50: ["Fifty!", "Somebody wake me up!", "Greatest of all time!"],
  runLegend: ["He's still going!", "Unbelievable!", "Never miss again!", "This is insane!"],

  // Bonus balls, called when one comes up (see bonus.js).
  moneyBall: ["Money ball!", "Golden ball!", "Double points!"],
  rainbowBall: ["Rainbow ball!", "It's a rainbow!", "Five points on the line!"],

  // Around the world.
  aroundLast: ["Last spot!", "One more!", "Bring it home!"],
  aroundDone: ["Around the world!", "World tour complete!", "Passport stamped!"],

  // HORSE (pass and play): the leader made it, someone matched it, a letter, out, and the winner.
  horseSet: ["Match that!", "Can you copy that?", "Your move!"],
  horseMatch: ["Matched it!", "Copycat!", "Right back at you!"],
  horseLetter: ["That's a letter!", "Letter!", "Uh oh, a letter!"],
  horseOut: ["That spells HORSE!", "You're out!", "H-O-R-S-E!"],
  horseWin: ["We have a winner!", "Last one standing!", "Champion of HORSE!"],
  // 3-point contest: on to the next rack, the last rack, a whole rack made, every rack shot.
  rackNext: ["Next rack!", "New rack!", "Keep it moving!"],
  rackLast: ["Last rack!", "Final rack!", "One rack left!"],
  rackPerfect: ["Perfect rack!", "Five for five!", "Cleaned out the rack!"],
  contestDone: ["That's the contest!", "Racks are empty!", "Out of balls!"],

  // The daily challenge, done.
  challenge: ["Challenge complete!", "Daily challenge done!"],

  // An instant replay of the game's best shot, after the game.
  replay: ["Let's see that again!", "Instant replay!", "Run it back!", "One more time, in slow motion!"],

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

// Specific moments only sometimes use their own list; otherwise they borrow from the
// general one, so every phrase gets a turn. 0.3 = own list 30% of the time.
const MIX = {
  swish: ["make", 0.3],
  bank: ["make", 0.4],
  three: ["make", 0.5],
  stillOnFire: ["make", 0.5],
  stillPurpleFire: ["make", 0.6],
  stillSupernova: ["make", 0.6],
  airball: ["miss", 0.5],
  cold: ["miss", 0.6],
};

const bags = {};
let last = "";

function draw(category) {
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

export function pickPhrase(category) {
  const mix = MIX[category];
  if (mix && Math.random() > mix[1]) category = mix[0];
  let phrase = draw(category);
  if (phrase === last && PHRASES[category].length > 1) phrase = draw(category); // never twice in a row
  last = phrase;
  return phrase;
}
