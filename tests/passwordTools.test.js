//All functions imported
const tests = require('../src/tools/passwordTools').helpers;

//hasKeyboardWalk()
//two cases done with different return value
test('uses adjacent keyboard substrings',() => {
    expect(tests.KeyboardWalk("dfgh")).toBe(true)
});

test('does not use adjacent keyboard substrings',() => {
    expect(tests.KeyboardWalk("skhd")).toBe(false)
});


//hasSequentialRun()
//Different scenarios tested -> All passed
test('has sequential alphabets',() => {
    expect(tests.SequentialRun("efghe",4)).toBe(true)
});

test('has sequential numbers',() => {
    expect(tests.SequentialRun("5678",4)).toBe(true)
});

test('does not have sequential alphabets',() => {
    expect(tests.SequentialRun("efgij",4)).toBe(false)
});

test('last four sequential but first not sequential',() => {
    expect(tests.SequentialRun("aefgh",4)).toBe(true)
});

test('first four sequential but last not sequential',() => {
    expect(tests.SequentialRun("efgha",4)).toBe(true)
});

test('first four sequential but last not sequential',() => {
    expect(tests.SequentialRun("efgha",5)).toBe(false)
});

test('last four sequential but first not sequential',() => {
    expect(tests.SequentialRun("aefgh",5)).toBe(false)
});

//hasRepeatedRun()
//All show expected behaviour
test('one sequence repeated rest unique',() => {
    expect(tests.RepeatedRun("ghbaaame",3)).toBe(true)
});

test('one sequence repeated with in between unique characters',() => {
    expect(tests.RepeatedRun("gahabame",3)).toBe(false)
});

test('one sequence repeated thrice for minrun=4',() => {
    expect(tests.RepeatedRun("ghbaaame",4)).toBe(false)
});

test('one sequence repeated thrice for minrun=4 with once differently',() => {
    expect(tests.RepeatedRun("ghabaaame",4)).toBe(false)
});

test('all sequences repeated',() => {
    expect(tests.RepeatedRun("aaabbbkkk",3)).toBe(true)
});

//isRepeatedPattern()
//Expected behaviour recorded
test('a pattern repeated',() => {
    expect(tests.RepeatedRun("aaabbaaabb")).toBe(true)
});

test('a pattern repeated only half',() => {
    expect(tests.RepeatedRun("aabbaabbaa")).toBe(false)
});

test('a pattern repeated with in between unique characters',() => {
    expect(tests.RepeatedRun("aabbzjhaabb")).toBe(false)
});

test('repeated characters having unique characters in between ',() => {
    expect(tests.RepeatedRun("aassbbkcaavxbb")).toBe(false)
});

//hasDatePattern()
//all provide expected behaviour
test('contains year',() => {
    expect(tests.DatePattern("1930")).toBe(true)
});

test('date format',() => {
    expect(tests.DatePattern("1930-08-01")).toBe(true)
});

test('number with dash',() => {
    expect(tests.DatePattern("01-")).toBe(false)
});

test('ddmmyy format',() => {
    expect(tests.DatePattern("01-02-26")).toBe(true)
});

test('year',() => {
    expect(tests.DatePattern("2000")).toBe(true)
});

//containsCommonSubstring()

test('common string',() => {
    expect(tests.CommonSubstring("password")).toBe("password")
});

test('common leet string',() => {
    expect(tests.CommonSubstring("passw0rd")).toBe("password")
});

test('common leet but not in dict of common string',() => {
    expect(tests.CommonSubstring("h44llo")).toBeNull()
});

//checkStrength()

//edge case of empty password checked
test('empty password',() => {
    const value = {"crackTimeEstimate": "Instantly", "entropyBits": 0, issues: ['No password provided'],"label": "Empty", "score": 0,}
    expect(tests.Strength("")).toMatchObject(value);
});


test('filled password',() => {
    const value = { "crackTimeEstimate": "Instantly", "entropyBits": 14, "issues": ["Shorter than 8 characters", "No uppercase letters", "No digits", "No symbols"],"label": "Very Weak",  "score": 2};
    expect(tests.Strength("fdd")).toMatchObject(value);
});

test('strong password',() => {
    const value = { "crackTimeEstimate": "Centuries", "entropyBits": 84, "issues": [],"label": "Very Strong",  "score": 100};
    expect(tests.Strength("Hsck_2enz_3q1")).toMatchObject(value);
});

//test case failed, returns a "strong password" but such a big password should be warned against. Changes need to made to passwordTools.js file for the same
test('very long password',() => {
    const value = { "crackTimeEstimate": "Centuries", "entropyBits": 652, "issues": ["Too long password"],"label": "Very Strong",  "score": 96};
    expect(tests.Strength("Hsck_2enz_3q1jka_dsvq234vmb_adkgjqqeug83gq-gwemnb3ioavqi3uwbkuqyrb32kuyvmdanvkeqi7o23lqaksbfcvkldusgh")).toMatchObject(value);
});

//since all special characters are recorded they ensure higher entropy compared to without it
test('Special character password',() => {
    const value = { "crackTimeEstimate": "Centuries", "entropyBits": 90, "issues": [],"label": "Very Strong",  "score": 100};
    expect(tests.Strength("Hsc&k*2enz%3q1")).toMatchObject(value);
});



