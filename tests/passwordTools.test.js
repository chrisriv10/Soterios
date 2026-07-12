//const test = require('node:test');
//const assert = require('node:assert/strict');
const {hasKeyboardWalk, hasSequentialRun, hasRepeatedRun, isRepeatedPattern, hasDatePattern, containsCommonSubstring, checkStrength} = require('../src/tools/passwordTools');

//hasKeyboardWalk()

test('uses adjacent keyboard substrings',() => {
    expect(hasKeyboardWalk("dfgh")).toBe(true)
});

test('does not use adjacent keyboard substrings',() => {
    expect(hasKeyboardWalk("skhd")).toBe(false)
});


//hasSequentialRun()

test('has sequential alphabets',() => {
    expect(hasSequentialRun("efghe",4)).toBe(true)
});

test('has sequential numbers',() => {
    expect(hasSequentialRun("5678",4)).toBe(true)
});

test('does not have sequential alphabets',() => {
    expect(hasSequentialRun("efgij",4)).toBe(false)
});

test('last four sequential but first not sequential',() => {
    expect(hasSequentialRun("aefgh",4)).toBe(true)
});

test('first four sequential but last not sequential',() => {
    expect(hasSequentialRun("efgha",4)).toBe(true)
});

test('first four sequential but last not sequential',() => {
    expect(hasSequentialRun("efgha",5)).toBe(false)
});

test('last four sequential but first not sequential',() => {
    expect(hasSequentialRun("aefgh",5)).toBe(false)
});

//hasRepeatedRun()

test('one sequence repeated rest unique',() => {
    expect(hasRepeatedRun("ghbaaame",3)).toBe(true)
});

test('one sequence repeated with in between unique characters',() => {
    expect(hasRepeatedRun("gahabame",3)).toBe(false)
});

test('one sequence repeated thrice for minrun=4',() => {
    expect(hasRepeatedRun("ghbaaame",4)).toBe(false)
});

test('one sequence repeated thrice for minrun=4 with once differently',() => {
    expect(hasRepeatedRun("ghabaaame",4)).toBe(false)
});

test('all sequences repeated',() => {
    expect(hasRepeatedRun("aaabbbkkk",3)).toBe(true)
});

//isRepeatedPattern()

test('a pattern repeated',() => {
    expect(hasRepeatedRun("aaabbaaabb")).toBe(true)
});

test('a pattern repeated only half',() => {
    expect(hasRepeatedRun("aabbaabbaa")).toBe(false)
});

test('a pattern repeated with in between unique characters',() => {
    expect(hasRepeatedRun("aabbzjhaabb")).toBe(false)
});

test('repeated characters having unique characters in between ',() => {
    expect(hasRepeatedRun("aassbbkcaavxbb")).toBe(false)
});

//hasDatePattern()

test('contains year',() => {
    expect(hasDatePattern("1930")).toBe(true)
});

test('date format',() => {
    expect(hasDatePattern("1930-08-01")).toBe(true)
});

test('number with dash',() => {
    expect(hasDatePattern("01-")).toBe(false)
});

test('ddmmyy format',() => {
    expect(hasDatePattern("01-02-26")).toBe(true)
});

test('year',() => {
    expect(hasDatePattern("2000")).toBe(true)
});

//containsCommonSubstring()

test('common string',() => {
    expect(containsCommonSubstring("password")).toBe("password")
});

test('common leet string',() => {
    expect(containsCommonSubstring("passw0rd")).toBe("password")
});

test('common leet but not in dict of common string',() => {
    expect(containsCommonSubstring("h44llo")).toBeNull
});

//checkStrength()

test('empty password',() => {
    expect(containsCommonSubstring("")).toEqual([0,'Empty',0,['No password provided'],'Instantly'])
});


