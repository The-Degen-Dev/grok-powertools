module.exports = {
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    verbose: true,
    moduleFileExtensions: ['js', 'json'],
    testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
    transform: {}
};
