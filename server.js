const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Create a new database (in memory for simplicity, use a file for persistence)
const db = new sqlite3.Database(':memory:');

// Track database initialization state
let isDatabaseInitialized = false;
let isInitializing = false;

// Helper function to execute SQL queries
function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Extract column names and types from CSV header row
function inferSchema(headerRow) {
  return headerRow.map(header => ({
    name: header,
    // We'll determine basic types
    type: 'TEXT' // Default type, could be refined
  }));
}

// Load CSV data into SQLite
async function loadCSVData(filePath, tableName) {
  try {
    // If already initializing, wait for it to complete
    if (isInitializing) {
      console.log('Database initialization already in progress, waiting...');
      
      // Wait until initialization is complete
      while (isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // If initialization completed successfully, return database info
      if (isDatabaseInitialized) {
        console.log('Using already initialized database');
        const tableInfo = await runQuery(`PRAGMA table_info(${tableName})`);
        const countResult = await runQuery(`SELECT COUNT(*) as count FROM ${tableName}`);
        return {
          tableName,
          rowCount: countResult[0].count,
          schema: tableInfo.map(info => ({
            name: info.name,
            type: info.type
          }))
        };
      }
    }
    
    // Set initialization flag
    isInitializing = true;
    
    console.log(`Loading CSV from ${filePath} into table ${tableName}`);
    
    // Read the first few lines to infer schema
    const sampleData = [];
    let headers = [];
    let headerProcessed = false;
    
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('headers', (headerRow) => {
          headers = headerRow;
          headerProcessed = true;
        })
        .on('data', (data) => {
          if (sampleData.length < 5) {
            sampleData.push(data);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    if (!headerProcessed || headers.length === 0) {
      isInitializing = false;
      throw new Error('Failed to process CSV headers');
    }
    
    // Infer schema from headers
    const schema = inferSchema(headers);
    
    // Create table with inferred schema
    const columnDefs = schema.map(col => `${col.name} ${col.type}`).join(', ');
    
    // First drop the table to ensure a clean slate
    await runQuery(`DROP TABLE IF EXISTS ${tableName}`);
    await runQuery(`CREATE TABLE ${tableName} (${columnDefs})`);
    
    // Process the entire CSV file and insert data in batches
    const batchSize = 1000;
    let batch = [];
    let totalRows = 0;
    
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          batch.push(row);
          
          if (batch.length >= batchSize) {
            // Insert batch
            const placeholders = headers.map(() => '?').join(', ');
            const stmt = db.prepare(`INSERT INTO ${tableName} VALUES (${placeholders})`);
            
            batch.forEach(record => {
              const values = headers.map(header => record[header]);
              stmt.run(values);
            });
            
            stmt.finalize();
            
            totalRows += batch.length;
            batch = [];
          }
        })
        .on('end', () => {
          // Insert remaining records
          if (batch.length > 0) {
            const placeholders = headers.map(() => '?').join(', ');
            const stmt = db.prepare(`INSERT INTO ${tableName} VALUES (${placeholders})`);
            
            batch.forEach(record => {
              const values = headers.map(header => record[header]);
              stmt.run(values);
            });
            
            stmt.finalize();
            
            totalRows += batch.length;
          }
          
          console.log(`Loaded ${totalRows} records into ${tableName}`);
          isDatabaseInitialized = true;
          isInitializing = false;
          resolve();
        })
        .on('error', (err) => {
          isInitializing = false;
          reject(err);
        });
    });
    
    return {
      tableName,
      rowCount: totalRows,
      schema
    };
  } catch (error) {
    // Reset initialization flags on error
    isInitializing = false;
    console.error('Error loading CSV data:', error);
    throw error;
  }
}

// Middleware to check if database is ready
function checkDatabaseReady(req, res, next) {
  // Skip check for initialization endpoint
  if (req.path === '/api/init' || req.path === '/health') {
    return next();
  }
  
  if (!isDatabaseInitialized) {
    return res.status(503).json({
      success: false,
      message: 'Database not initialized. Please call /api/init endpoint first.'
    });
  }
  
  next();
}

// Apply database check middleware
app.use(checkDatabaseReady);

app.get('/', (req,res)=>{
  res.send("backend is running !")
})

// API endpoint to initialize database with CSV
app.post('/api/init', async (req, res) => {
  try {
    // If database is already initialized and not currently initializing
    if (isDatabaseInitialized && !isInitializing) {
      const tableInfo = await runQuery('PRAGMA table_info(orders)');
      const countResult = await runQuery('SELECT COUNT(*) as count FROM orders');
      
      return res.json({
        success: true,
        message: `Database already initialized with ${countResult[0].count} rows in table orders`,
        schema: tableInfo.map(info => ({
          name: info.name,
          type: info.type
        }))
      });
    }
    
    // If file was previously uploaded
    const csvPath = path.join(__dirname, 'public', 'orders.csv');
    
    // Check if the file exists
    if (!fs.existsSync(csvPath)) {
      return res.status(404).json({
        success: false,
        message: 'CSV file not found. Please upload the file first.'
      });
    }
    
    const result = await loadCSVData(csvPath, 'orders');
    
    res.json({
      success: true,
      message: `Successfully loaded ${result.rowCount} rows into table ${result.tableName}`,
      schema: result.schema
    });
  } catch (error) {
    console.error('Error initializing database:', error);
    res.status(500).json({
      success: false,
      message: `Error initializing database: ${error.message}`
    });
  }
});

// API endpoint to execute queries
app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).json({ 
      success: false, 
      message: 'Query is required' 
    });
  }
  
  console.log('Executing query:', query);
  
  try {
    const startTime = Date.now();
    
    const rows = await runQuery(query);
    
    const executionTime = Date.now() - startTime;
    
    console.log(`Query executed in ${executionTime}ms, returned ${rows.length} rows`);
    
    res.json({
      success: true,
      data: rows,
      executionTime,
      message: `Query executed successfully. ${rows.length} rows returned.`
    });
  } catch (error) {
    console.error('Error executing query:', error);
    res.status(400).json({
      success: false,
      message: `Error executing query: ${error.message}`
    });
  }
});

// API endpoint to get schema information
app.get('/api/schema/:tableName', async (req, res) => {
  const { tableName } = req.params;
  
  try {
    const tableInfo = await runQuery(`PRAGMA table_info(${tableName})`);
    
    if (tableInfo.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Table ${tableName} not found`
      });
    }
    
    res.json({
      success: true,
      schema: tableInfo.map(info => ({
        name: info.name,
        type: info.type
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error fetching schema: ${error.message}`
    });
  }
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
    dbInitialized: isDatabaseInitialized,
    dbInitializing: isInitializing
  });
});

// Auto-initialize database if CSV exists
(async function() {
  try {
    const csvPath = path.join(__dirname, 'public', 'orders.csv');
    if (fs.existsSync(csvPath)) {
      console.log('Found CSV file, auto-initializing database...');
      await loadCSVData(csvPath, 'orders');
      console.log('Database auto-initialization complete');
    } else {
      console.log('No CSV file found for auto-initialization');
    }
  } catch (error) {
    console.error('Error during auto-initialization:', error);
  }
})();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('To initialize the database, place orders.csv in the public folder');
  console.log('and make a POST request to /api/init');
});



