#!/bin/bash

# Find all TypeScript files and remove .ts extensions from imports
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./dist/*" | while read file; do
    echo "Processing $file"
    # Remove .ts extensions from import statements
    sed -i '' "s/from '\([^']*\)\.ts'/from '\1'/g" "$file"
    sed -i '' "s/from \"\([^\"]*\)\.ts\"/from \"\1\"/g" "$file"
done

echo "Done removing .ts extensions from imports"
