const test = require('node:test');
const assert = require('node:assert/strict');
const passwordTools = require('../src/tools/passwordTools');


//hasKeyboardWalk()

test('uses adjacent keyboard substrings',() => {
    expect(hasKeyboardWalk("dfgh").toBe(true))
});

test('uses adjacent keyboard substrings',() => {
    expect(hasKeyboardWalk("skhd").toBe(false))
});

//hasSequentialRun()

//hasRepeatedRun()

//isRepeatedPattern()

//hasDatePattern()

//containsCommonSubstring()

//checkStrength()

