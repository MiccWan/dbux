function renderMessage(msg) {
  console.log(msg);
}

debugger;

class Animal {
  speak() {
  }
}

class Duck extends Animal {
  speak() {
    renderMessage('quack quack');
  }
}

class Cow extends Animal {
  speak() {
    renderMessage('mooo');
  }
}

class Dog extends Animal {
  speak() {
    renderMessage('旺旺');
  }
}

const AnimalClasses = [
  Duck,
  Cow,
  Dog
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}


function main() {
  const animals = Array(20).fill(0).map(i => {
    // const AnimalClass = pickRandom(AnimalClasses);
    // return new pickRandom(AnimalClasses)();
    return new AnimalClasses[Math.floor(Math.random() * AnimalClasses.length)]();
  });

  for (const animal of animals) {
    animal.speak();
  }
}

main();