const neo4j = require('neo4j-driver');

const driver = neo4j.driver('bolt://neo4j:7687', neo4j.auth.basic('neo4j', 'password'));
const session = driver.session();

session.run(`
  MATCH (f:file) 
  WHERE f.path CONTAINS 'docs' OR f.path CONTAINS 'AGENTS' OR f.path CONTAINS 'README'
  RETURN f.path 
  ORDER BY f.path
  LIMIT 20
`)
.then(result => {
  console.log('=== Files containing "docs" in path ===');
  result.records.forEach(record => {
    console.log(record.get('f.path'));
  });
  return session.close();
})
.then(() => driver.close())
.catch(error => {
  console.error('Error:', error);
  session.close();
  driver.close();
});
