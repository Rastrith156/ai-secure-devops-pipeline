pipeline {
    agent any

    stages {

        stage('Install') {
            steps {
                sh '''
                echo "Creating virtual environment..."
                python3 -m venv venv

                echo "Activating venv and installing dependencies..."
                . venv/bin/activate
                pip install --upgrade pip
                pip install -r requirements.txt || true
                '''
            }
        }

        stage('Test') {
            steps {
                sh '''
                echo "Running tests..."
                . venv/bin/activate
                python3 -m unittest discover || true
                '''
            }
        }

        stage('AI Security Scan') {
            steps {
                sh '''
                echo "Running AI security scan..."
                . venv/bin/activate
                python3 security_scan.py
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo "Deploying application (simulation)..."
            }
        }
    }

    post {
        success {
            echo "✅ Pipeline completed successfully"
        }
        failure {
            echo "❌ Pipeline failed"
        }
    }
}
