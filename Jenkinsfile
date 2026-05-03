pipeline {
    agent any

    stages {

        stage('Install') {
            steps {
                sh 'pip install -r requirements.txt'
            }
        }

        stage('Test') {
            steps {
                sh 'pytest'
            }
        }

        stage('AI Security Scan') {
    steps {
        sh 'python3 security_scan.py'
    }
}

        stage('Deploy') {
            steps {
                echo "Deploying..."
            }
        }
    }
}
