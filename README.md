# SQL Query Runner Backend

A robust backend service that enables loading CSV data into an in-memory SQLite database and executing SQL queries against it. This tool is perfect for data analysis, testing SQL queries, and working with CSV datasets.

### 
Backend is hosted on a remote server on reder whose link is https://tanmayprojbackend.onrender.com

## Features

- **CSV Data Loading**: Load CSV files into an in-memory SQLite database
- **SQL Query Execution**: Run any valid SQLite query against your loaded data
- **Schema Information**: Retrieve table schema information
- **Automatic Type Inference**: Basic type inference for CSV columns
- **Batch Processing**: Efficient loading of large CSV files using batch processing
- **Fast Response Times**: In-memory database for quick query execution


## API Endpoints

### Initialize Database with CSV

```
POST /api/init
```

Loads data from a CSV file (expects `orders.csv` to be in the public folder) into the database.

**Response:**
```json
{
  "success": true,
  "message": "Successfully loaded X rows into table orders",
  "schema": [...]
}
```

### Execute SQL Query

```
POST /api/query
```

**Request Body:**
```json
{
  "query": "SELECT * FROM orders LIMIT 10"
}
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "executionTime": 10,
  "message": "Query executed successfully. X rows returned."
}
```

### Get Table Schema

```
GET /api/schema/:tableName
```

**Response:**
```json
{
  "success": true,
  "schema": [
    {
      "name": "column1",
      "type": "TEXT"
    },
    ...
  ]
}
```

## Getting Started

The server will be hosted on a remote server on reder whose link is https://sql-query-runner-backend.onrender.com

### Usage

1. Place your CSV file (named `orders.csv`) in the `public` folder
2. Initialize the database by making a POST request to `/api/init`
3. Start querying your data by making POST requests to `/api/query`

## Data Processing

The application processes CSV data using the following approach:

1. Reads CSV headers to infer schema
2. Creates a table with appropriate columns
3. Loads data in batches of 1000 rows for efficiency
4. Stores everything in an in-memory SQLite database

## Limitations

- In-memory database means data is lost when the server restarts
- Only supports SQLite query syntax
- Default column type is TEXT (basic type inference)
- Currently designed to work with a single table named "orders"

## Future Enhancements

- Support for multiple tables
- Persistent database option by connecting to a remote database
- More sophisticated type inference
- Upload endpoint for CSV files
- Query history tracking
- Export query results to CSV
